import { createPublicKey, verify } from 'node:crypto'
import { readEnv } from './runtime'

export function authorizeTelnyxWebhook(request: Request, rawBody: string): Response | null {
  const publicKey = readEnv('TELNYX_PUBLIC_KEY')
  if (!publicKey) return new Response('Webhook verification unavailable', { status: 503 })
  const timestamp = request.headers.get('telnyx-timestamp') || ''
  const signature = request.headers.get('telnyx-signature-ed25519') || ''
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return new Response('Unauthorized', { status: 401 })
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' })
    if (verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, 'base64'))) return null
  } catch { /* Malformed signatures fail closed. */ }
  return new Response('Unauthorized', { status: 401 })
}
