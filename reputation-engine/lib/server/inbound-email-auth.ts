import { Resend } from 'resend'
import { getWorkerSharedSecret, readEnv } from './runtime'
import { secretsEqual } from './security'

// Verification is local: no API requests or real API key are required.
const verifier = new Resend('local-webhook-verification-only').webhooks

export function authorizeInboundEmail(request: Request, rawBody: string):
  | { authorized: true; isWorker: boolean }
  | { authorized: false; response: Response } {
  if (secretsEqual(request.headers.get('x-internal-secret') || '', getWorkerSharedSecret())) {
    return { authorized: true, isWorker: true }
  }
  const secret = readEnv('RESEND_WEBHOOK_SECRET')
  if (!secret) {
    console.error('Inbound email verification unavailable: RESEND_WEBHOOK_SECRET is not configured')
    return { authorized: false, response: new Response('Webhook verification unavailable', { status: 503 }) }
  }
  try {
    verifier.verify({
      payload: rawBody,
      webhookSecret: secret,
      headers: {
        id: request.headers.get('svix-id') || '',
        timestamp: request.headers.get('svix-timestamp') || '',
        signature: request.headers.get('svix-signature') || '',
      },
    })
    return { authorized: true, isWorker: false }
  } catch {
    return { authorized: false, response: new Response('Unauthorized', { status: 401 }) }
  }
}
