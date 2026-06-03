import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

const IDENTITY_PREFIX = 'partnership-rep'

function toBase64Url(input: string | ArrayBuffer): string {
  const str = typeof input === 'string'
    ? input
    : Array.from(new Uint8Array(input), b => String.fromCharCode(b)).join('')
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function buildVoiceToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  twimlAppSid: string,
  identity: string,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    exp,
    grants: {
      identity,
      voice: {
        incoming: { allow: false },
        outgoing: { application_sid: twimlAppSid },
      },
    },
  }

  const encodedHeader = toBase64Url(JSON.stringify(header))
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))

  return {
    token: `${signingInput}.${toBase64Url(sigBytes)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const apiKeySid = readEnv('TWILIO_API_KEY_SID')
  const apiKeySecret = readEnv('TWILIO_API_KEY_SECRET')
  const twimlAppSid = readEnv('TWILIO_PARTNERSHIP_TWIML_APP_SID') || readEnv('TWILIO_TWIML_APP_SID')

  const missing = [
    !accountSid && 'TWILIO_ACCOUNT_SID',
    !apiKeySid && 'TWILIO_API_KEY_SID',
    !apiKeySecret && 'TWILIO_API_KEY_SECRET',
    !twimlAppSid && 'TWILIO_PARTNERSHIP_TWIML_APP_SID',
  ].filter(Boolean)

  if (missing.length > 0) {
    return NextResponse.json({ error: `Dialer not configured — missing: ${missing.join(', ')}` }, { status: 500 })
  }

  const identity = `${IDENTITY_PREFIX}-${session.userId}`
  const { token, expiresAt } = await buildVoiceToken(accountSid!, apiKeySid!, apiKeySecret!, twimlAppSid!, identity)

  return NextResponse.json({ ok: true, token, identity, expiresAt })
}
