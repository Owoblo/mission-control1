import crypto from 'crypto'
import { readEnv, requireEnv } from '@/lib/server/runtime'

export type StoragePutInput = {
  key: string
  body: Buffer | ArrayBuffer | Uint8Array
  contentType?: string
  metadata?: Record<string, string | undefined>
}

export type StorageObjectHead = {
  key: string
  size: number
  contentType?: string
  etag?: string
  lastModified?: string
}

function toBuffer(body: Buffer | ArrayBuffer | Uint8Array) {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body))
  return Buffer.from(body)
}

function toArrayBufferView(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

export interface StorageService {
  readonly provider: string
  putObject(input: StoragePutInput): Promise<StorageObjectHead>
  headObject(key: string): Promise<StorageObjectHead | null>
  getObject(key: string): Promise<{ buffer: Buffer; contentType: string; head: StorageObjectHead }>
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>
  deleteObject(key: string): Promise<void>
}

function encodePathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeObjectKey(key: string) {
  return key.split('/').map(encodePathSegment).join('/')
}

function sha256Hex(value: string | Buffer | Uint8Array) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

function hmacHex(key: Buffer, value: string) {
  return crypto.createHmac('sha256', key).update(value).digest('hex')
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function dateScope(amz: string) {
  return amz.slice(0, 8)
}

function normalizeMetadata(metadata?: Record<string, string | undefined>) {
  const headers: Record<string, string> = {}
  Object.entries(metadata || {}).forEach(([key, value]) => {
    const normalized = String(value || '').trim()
    if (!normalized) return
    headers[`x-amz-meta-${key.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`] = normalized
  })
  return headers
}

function canonicalQuery(params: URLSearchParams) {
  return Array.from(params.entries())
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function parseHeadResponse(key: string, response: Response): StorageObjectHead {
  return {
    key,
    size: Number(response.headers.get('content-length') || 0) || 0,
    contentType: response.headers.get('content-type') || undefined,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
  }
}

type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export class R2StorageService implements StorageService {
  readonly provider = 'r2'
  private readonly region = 'auto'
  private readonly service = 's3'
  private readonly config: R2Config

  constructor(config?: Partial<R2Config>) {
    this.config = {
      accountId: config?.accountId || requireEnv('R2_ACCOUNT_ID', 'Missing R2_ACCOUNT_ID'),
      accessKeyId: config?.accessKeyId || requireEnv('R2_ACCESS_KEY_ID', 'Missing R2_ACCESS_KEY_ID'),
      secretAccessKey: config?.secretAccessKey || requireEnv('R2_SECRET_ACCESS_KEY', 'Missing R2_SECRET_ACCESS_KEY'),
      bucket: config?.bucket || requireEnv('R2_BUCKET', 'Missing R2_BUCKET'),
    }
  }

  private endpointForKey(key: string) {
    const host = `${this.config.accountId}.r2.cloudflarestorage.com`
    const pathname = `/${this.config.bucket}/${encodeObjectKey(key)}`
    return { host, pathname, url: `https://${host}${pathname}` }
  }

  private signingKey(scopeDate: string) {
    const dateKey = hmac(`AWS4${this.config.secretAccessKey}`, scopeDate)
    const regionKey = hmac(dateKey, this.region)
    const serviceKey = hmac(regionKey, this.service)
    return hmac(serviceKey, 'aws4_request')
  }

  private signHeaders(input: {
    method: string
    key: string
    headers?: Record<string, string>
    payloadHash: string
    now?: Date
  }) {
    const { host, pathname, url } = this.endpointForKey(input.key)
    const timestamp = amzDate(input.now)
    const scopeDate = dateScope(timestamp)
    const scope = `${scopeDate}/${this.region}/${this.service}/aws4_request`
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': input.payloadHash,
      'x-amz-date': timestamp,
      ...(input.headers || {}),
    }
    const sortedHeaderKeys = Object.keys(headers).map(key => key.toLowerCase()).sort()
    const canonicalHeaders = sortedHeaderKeys.map(key => `${key}:${headers[key].trim()}\n`).join('')
    const signedHeaders = sortedHeaderKeys.join(';')
    const canonicalRequest = [
      input.method,
      pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      input.payloadHash,
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = hmacHex(this.signingKey(scopeDate), stringToSign)

    return {
      url,
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    }
  }

  async putObject(input: StoragePutInput): Promise<StorageObjectHead> {
    const body = toBuffer(input.body)
    const contentType = input.contentType || 'application/octet-stream'
    const payloadHash = sha256Hex(body)
    const signed = this.signHeaders({
      method: 'PUT',
      key: input.key,
      payloadHash,
      headers: {
        'content-length': String(body.byteLength),
        'content-type': contentType,
        ...normalizeMetadata(input.metadata),
      },
    })

    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: toArrayBufferView(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`R2 upload failed: ${response.status}${detail ? ` ${detail}` : ''}`)
    }

    const verified = await this.headObject(input.key)
    if (!verified || verified.size !== body.byteLength) {
      throw new Error(`R2 upload verification failed for ${input.key}`)
    }
    return { ...verified, contentType: verified.contentType || contentType }
  }

  async headObject(key: string): Promise<StorageObjectHead | null> {
    const signed = this.signHeaders({
      method: 'HEAD',
      key,
      payloadHash: 'UNSIGNED-PAYLOAD',
    })
    const response = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`R2 head failed: ${response.status}`)
    }
    return parseHeadResponse(key, response)
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const { host, pathname, url } = this.endpointForKey(key)
    const timestamp = amzDate()
    const scopeDate = dateScope(timestamp)
    const scope = `${scopeDate}/${this.region}/${this.service}/aws4_request`
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': timestamp,
      'X-Amz-Expires': String(Math.max(60, Math.min(expiresInSeconds, 3600))),
      'X-Amz-SignedHeaders': 'host',
    })
    const query = canonicalQuery(params)
    const canonicalRequest = [
      'GET',
      pathname,
      query,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signature = hmacHex(this.signingKey(scopeDate), stringToSign)
    return `${url}?${query}&X-Amz-Signature=${signature}`
  }

  async getObject(key: string): Promise<{ buffer: Buffer; contentType: string; head: StorageObjectHead }> {
    const signedUrl = await this.getSignedReadUrl(key, 300)
    const response = await fetch(signedUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      throw new Error(`R2 download failed: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      head: {
        key,
        size: buffer.byteLength,
        contentType: response.headers.get('content-type') || undefined,
        etag: response.headers.get('etag') || undefined,
        lastModified: response.headers.get('last-modified') || undefined,
      },
    }
  }

  async deleteObject(key: string): Promise<void> {
    const signed = this.signHeaders({
      method: 'DELETE',
      key,
      payloadHash: 'UNSIGNED-PAYLOAD',
    })
    const response = await fetch(signed.url, {
      method: 'DELETE',
      headers: signed.headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 delete failed: ${response.status}`)
    }
  }
}

export function getStorageProviderName() {
  return readEnv('STORAGE_PROVIDER') || 'r2'
}

export function isObjectStorageConfigured() {
  const provider = getStorageProviderName()
  if (provider !== 'r2') return false
  return Boolean(readEnv('R2_ACCOUNT_ID') && readEnv('R2_ACCESS_KEY_ID') && readEnv('R2_SECRET_ACCESS_KEY') && readEnv('R2_BUCKET'))
}

export function getStorageService(): StorageService {
  const provider = getStorageProviderName()
  if (provider === 'r2') return new R2StorageService()
  throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`)
}

export function buildRecordingObjectKey(input: {
  callSid: string
  recordingSid?: string | null
  createdAt?: string | null
  city?: string | null
}) {
  const date = input.createdAt ? new Date(input.createdAt) : new Date()
  const yyyy = Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear()
  const mm = String((Number.isNaN(date.getTime()) ? new Date() : date).getUTCMonth() + 1).padStart(2, '0')
  const dd = String((Number.isNaN(date.getTime()) ? new Date() : date).getUTCDate()).padStart(2, '0')
  const city = (input.city || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
  const id = input.recordingSid || input.callSid
  return `recordings/${city}/${yyyy}/${mm}/${dd}/${input.callSid}/${id}.mp3`
}
