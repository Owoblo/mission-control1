import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

const IDENTITY_PREFIX = 'saturn-rep'

function toBase64Url(input: string | ArrayBuffer): string {
  let str: string
  if (typeof input === 'string') {
    str = input
  } else {
    const bytes = new Uint8Array(input)
    str = Array.from(bytes, b => String.fromCharCode(b)).join('')
  }
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
        incoming: { allow: true },
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
  const encodedSig = toBase64Url(sigBytes)

  return {
    token: `${signingInput}.${encodedSig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

export async function GET() {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const apiKeySid = readEnv('TWILIO_API_KEY_SID')
    const apiKeySecret = readEnv('TWILIO_API_KEY_SECRET')
    const twimlAppSid = readEnv('TWILIO_TWIML_APP_SID')
    const missing = [
      !accountSid ? 'TWILIO_ACCOUNT_SID' : null,
      !apiKeySid ? 'TWILIO_API_KEY_SID' : null,
      !apiKeySecret ? 'TWILIO_API_KEY_SECRET' : null,
      !twimlAppSid ? 'TWILIO_TWIML_APP_SID' : null,
    ].filter(Boolean)

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Dialer not configured — missing ${missing.join(', ')}` },
        { status: 500 },
      )
    }

    // Each rep gets a unique identity so all active browsers can ring simultaneously on inbound calls.
    if (!sessionUser.userId) {
      return NextResponse.json(
        { error: 'Your session predates multi-rep calling. Sign out and back in to reconnect the dialer safely.' },
        { status: 409 },
      )
    }
    const identity = `${IDENTITY_PREFIX}-${sessionUser.userId}`
    const { token, expiresAt } = await buildVoiceToken(accountSid, apiKeySid, apiKeySecret, twimlAppSid, identity)

    return NextResponse.json({
      ok: true,
      token,
      identity,
      repName: sessionUser.name || identity,
      repId: sessionUser.userId || null,
      expiresAt,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize dialer' },
      { status: 500 },
    )
  }
}
