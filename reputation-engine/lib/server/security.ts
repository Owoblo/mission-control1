import { timingSafeEqual } from 'node:crypto'
import { readEnv } from './runtime'

export function secretsEqual(actual: string, expected: string) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export function randomToken(prefix: string, byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  const token = Buffer.from(bytes)
    .toString('base64url')
    .replace(/=+$/g, '')
  return `${prefix}_${token}`
}

export async function verifyTwilioSignature(request: Request, rawBody: string) {
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!authToken) return false

  const signature = request.headers.get('x-twilio-signature') || ''
  if (!signature) return false

  const params = new URLSearchParams(rawBody)
  const sortedKeys = Array.from(new Set(params.keys())).sort()
  const suffix = sortedKeys.map(key =>
    Array.from(new Set(params.getAll(key))).sort().map(value => key + value).join('')
  ).join('')
  // A trusted configured origin supports reverse proxies without trusting arbitrary
  // X-Forwarded-* headers. Preserve path/query exactly, including encoded values.
  const urls = new Set([request.url])
  const appUrl = readEnv('NEXT_PUBLIC_APP_URL')
  if (appUrl) {
    try {
      const external = new URL(appUrl)
      const incoming = new URL(request.url)
      if (external.protocol === 'https:' || external.protocol === 'http:') {
        urls.add(`${external.origin}${incoming.pathname}${incoming.search}`)
      }
    } catch { /* Invalid configuration cannot add a trusted URL. */ }
  }
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  for (const url of urls) {
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(url + suffix))
    if (secretsEqual(signature, Buffer.from(signatureBuffer).toString('base64'))) return true
  }
  return false
}

export async function authorizeTwilioWebhook(request: Request, rawBody: string): Promise<Response | null> {
  if (!readEnv('TWILIO_AUTH_TOKEN')) {
    console.error('Twilio webhook verification unavailable: TWILIO_AUTH_TOKEN is not configured')
    return new Response('Webhook verification unavailable', { status: 503 })
  }
  try {
    if (await verifyTwilioSignature(request, rawBody)) return null
  } catch { /* Verification errors must not enter the side-effect path. */ }
  return new Response('Unauthorized', { status: 401 })
}
