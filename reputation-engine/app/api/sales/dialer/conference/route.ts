import { getAppBaseUrl, getTwilioCredentials } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { hasInternalSession } from '@/lib/server/session'

const CALLER_ID = '+12267732993'

function xmlUrl(url: string) {
  return url.replace(/&/g, '&amp;')
}

async function twilioPost(accountSid: string, authToken: string, path: string, body: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuth(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(String(payload.message || `Twilio error ${res.status}`))
  return payload
}

function conferenceTwiml(conferenceName: string) {
  // endConferenceOnExit: true on manager leg so conference ends when manager leaves
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference endConferenceOnExit="false" startConferenceOnEnter="true" beep="false" muted="false">${conferenceName}</Conference></Dial></Response>`
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-conference' })
}

// POST body: { customerCallSid, addTarget, repIdentity }
// customerCallSid: the active call SID with the customer
// addTarget: phone number, sip URI, or browser client identity to add
// repIdentity: the requesting rep's browser identity (so they can be re-dialed into the conf)
export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as {
      customerCallSid?: string
      addTarget?: string
      repIdentity?: string
    }

    const { customerCallSid, addTarget, repIdentity } = body
    if (!customerCallSid || !addTarget) {
      return Response.json({ error: 'customerCallSid and addTarget required' }, { status: 400 })
    }

    const { accountSid, authToken } = getTwilioCredentials()
    const appUrl = getAppBaseUrl()
    const confName = `saturn-conf-${Date.now()}`
    const confTwiml = conferenceTwiml(confName)

    // Step 1: Move the customer's call into the conference
    await twilioPost(accountSid, authToken, `/Calls/${customerCallSid}.json`, {
      Twiml: confTwiml,
    })

    // Step 2: Dial the target into the conference
    const targetTwiml = conferenceTwiml(confName)
    let toParam = addTarget.trim()
    let twimlForTarget = targetTwiml
    if (toParam.toLowerCase().startsWith('client:')) {
      toParam = toParam.slice(7)
    }
    const toField = toParam.startsWith('sip:') ? toParam
      : toParam.startsWith('+') || /^\d{10,}$/.test(toParam) ? toParam
      : `client:${toParam}`

    if (toField.startsWith('client:')) {
      // Browser SDK call — use identity
      const identity = toField.slice(7)
      twimlForTarget = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference endConferenceOnExit="false" startConferenceOnEnter="true" beep="false">${confName}</Conference></Dial></Response>`
      await twilioPost(accountSid, authToken, '/Calls.json', {
        From: CALLER_ID,
        To: `client:${identity}`,
        Twiml: twimlForTarget,
      })
    } else if (toField.startsWith('sip:')) {
      await twilioPost(accountSid, authToken, '/Calls.json', {
        From: CALLER_ID,
        To: toField,
        Twiml: twimlForTarget,
      })
    } else {
      await twilioPost(accountSid, authToken, '/Calls.json', {
        From: CALLER_ID,
        To: toField,
        Twiml: twimlForTarget,
      })
    }

    // Step 3: Re-dial the requesting rep's browser back into the conference
    // (their original SDK call lost audio when customer moved to conf)
    if (repIdentity) {
      await twilioPost(accountSid, authToken, '/Calls.json', {
        From: CALLER_ID,
        To: `client:${repIdentity}`,
        Twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Joining conference.</Say><Dial><Conference endConferenceOnExit="true" startConferenceOnEnter="true" beep="false">${confName}</Conference></Dial></Response>`,
      })
    }

    return Response.json({ ok: true, conferenceName: confName })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Conference failed' },
      { status: 500 }
    )
  }
}
