import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { readEnv } from '@/lib/server/runtime'

const IDENTITY_PREFIX = 'saturn-rep'

import { buildVoiceToken } from '@/lib/server/voice-token'

export async function GET(request: Request) {
  try {
    const sessionUser = await getRequestSessionUser(request)
    if (!sessionUser || !['owner', 'manager', 'sales_rep', 'operations_lead', 'partnership_manager'].includes(sessionUser.role || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const apiKeySid = readEnv('TWILIO_API_KEY_SID')
    const apiKeySecret = readEnv('TWILIO_API_KEY_SECRET')
    const twimlAppSid = readEnv('TWILIO_TWIML_APP_SID')
    const pushCredentialSid = readEnv('TWILIO_VOICE_PUSH_CREDENTIAL_SID')
    const missing = [
      !accountSid ? 'TWILIO_ACCOUNT_SID' : null,
      !apiKeySid ? 'TWILIO_API_KEY_SID' : null,
      !apiKeySecret ? 'TWILIO_API_KEY_SECRET' : null,
      !twimlAppSid ? 'TWILIO_TWIML_APP_SID' : null,
      !pushCredentialSid ? 'TWILIO_VOICE_PUSH_CREDENTIAL_SID' : null,
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
    const { token, expiresAt } = await buildVoiceToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      twimlAppSid,
      identity,
      pushCredentialSid,
    )

    return NextResponse.json({
      ok: true,
      token,
      identity,
      repName: sessionUser.name || identity,
      repId: sessionUser.userId || null,
      expiresAt,
      pushConfigured: Boolean(pushCredentialSid),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize dialer' },
      { status: 500 },
    )
  }
}
