import { createHmac, timingSafeEqual } from 'crypto'
import { getAppBaseUrl, getTwilioCredentials } from '@/lib/server/runtime'

function constantTimeEquals(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function twilioSignatureFor(url: string, params: URLSearchParams, authToken: string) {
  const pairs = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right))
  const payload = pairs.reduce((acc, [key, value]) => `${acc}${key}${value}`, url)
  return createHmac('sha1', authToken).update(payload).digest('base64')
}

function candidateWebhookUrls(request: Request) {
  const parsed = new URL(request.url)
  const configuredBase = getAppBaseUrl()
  const urls = new Set<string>([request.url])

  if (configuredBase) {
    urls.add(`${configuredBase}${parsed.pathname}${parsed.search}`)
  }

  return Array.from(urls)
}

export function verifyTwilioWebhook(request: Request, body: string) {
  const signature = request.headers.get('x-twilio-signature') || ''
  if (!signature) return false

  let authToken = ''
  try {
    authToken = getTwilioCredentials().authToken
  } catch {
    return false
  }

  const params = new URLSearchParams(body)
  return candidateWebhookUrls(request).some(url =>
    constantTimeEquals(twilioSignatureFor(url, params, authToken), signature)
  )
}

function svixSecretBytes(secret: string) {
  const normalized = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  try {
    return Buffer.from(normalized, 'base64')
  } catch {
    return Buffer.from(secret)
  }
}

export function verifySvixWebhook(request: Request, body: string, secret: string) {
  const id = request.headers.get('svix-id') || ''
  const timestamp = request.headers.get('svix-timestamp') || ''
  const signatureHeader = request.headers.get('svix-signature') || ''
  if (!id || !timestamp || !signatureHeader || !secret) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) return false

  const expected = createHmac('sha256', svixSecretBytes(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')

  return signatureHeader
    .split(' ')
    .some(signature => {
      const value = signature.startsWith('v1,') ? signature.slice(3) : signature
      return constantTimeEquals(expected, value)
    })
}
