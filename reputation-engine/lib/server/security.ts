import { readEnv } from './runtime'

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

  const params: Record<string, string> = {}
  new URLSearchParams(rawBody).forEach((value, key) => {
    params[key] = value
  })

  const sortedKeys = Object.keys(params).sort()
  const valueString = sortedKeys.reduce((acc, key) => acc + key + params[key], request.url)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(valueString))
  const expected = Buffer.from(signatureBuffer).toString('base64')
  return signature === expected
}
