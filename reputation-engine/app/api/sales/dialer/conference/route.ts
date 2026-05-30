import { getTwilioCredentials } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { hasInternalSession } from '@/lib/server/session'
import { pickSaturnBranchPhoneNumber } from '@/lib/sales-phones'

type ConferenceAction = 'start' | 'complete' | 'return' | 'end'

type StartConferenceBody = {
  action?: 'start'
  customerCallSid?: string
  addTarget?: string
  repIdentity?: string
  callerId?: string | null
}

type UpdateConferenceBody = {
  action: 'complete' | 'return' | 'end'
  conferenceName?: string
  targetCallSid?: string
  repCallSid?: string
}

type ConferenceRequestBody = StartConferenceBody | UpdateConferenceBody

function conferenceTwiml(conferenceName: string, options?: { announce?: string }) {
  const announce = options?.announce
    ? `<Say voice="alice">${options.announce}</Say>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${announce}<Dial><Conference endConferenceOnExit="false" startConferenceOnEnter="true" beep="false" muted="false">${conferenceName}</Conference></Dial></Response>`
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

function normalizeDialTarget(value: string) {
  const trimmed = value.trim()
  if (trimmed.toLowerCase().startsWith('client:')) {
    return { kind: 'client' as const, target: trimmed.slice(7) }
  }
  if (trimmed.toLowerCase().startsWith('sip:')) {
    return { kind: 'sip' as const, target: trimmed }
  }
  if (trimmed.startsWith('+') || /^\d{10,}$/.test(trimmed)) {
    return { kind: 'number' as const, target: trimmed }
  }
  return { kind: 'client' as const, target: trimmed }
}

async function completeCall(accountSid: string, authToken: string, callSid?: string | null) {
  if (!callSid) return null
  return twilioPost(accountSid, authToken, `/Calls/${callSid}.json`, {
    Status: 'completed',
  }).catch(() => null)
}

async function handleStartConference(body: StartConferenceBody) {
  const { customerCallSid, addTarget, repIdentity } = body
  if (!customerCallSid || !addTarget) {
    return Response.json({ error: 'customerCallSid and addTarget required' }, { status: 400 })
  }

  const { accountSid, authToken } = getTwilioCredentials()
  const callerId = pickSaturnBranchPhoneNumber(body.callerId)
  const conferenceName = `saturn-conf-${Date.now()}`
  const moveCustomerTwiml = conferenceTwiml(conferenceName)

  await twilioPost(accountSid, authToken, `/Calls/${customerCallSid}.json`, {
    Twiml: moveCustomerTwiml,
  })

  const normalizedTarget = normalizeDialTarget(addTarget)
  const targetCall = await twilioPost(accountSid, authToken, '/Calls.json', {
    From: callerId,
    To: normalizedTarget.kind === 'client' ? `client:${normalizedTarget.target}` : normalizedTarget.target,
    Twiml: conferenceTwiml(conferenceName),
  })

  let repCallSid: string | null = null
  if (repIdentity?.trim()) {
    const repCall = await twilioPost(accountSid, authToken, '/Calls.json', {
      From: callerId,
      To: `client:${repIdentity.trim()}`,
      Twiml: conferenceTwiml(conferenceName, { announce: 'Joining transfer bridge.' }),
    }).catch(() => null)
    repCallSid = typeof repCall?.sid === 'string' ? repCall.sid : null
  }

  return Response.json({
    ok: true,
    conferenceName,
    customerCallSid,
    targetCallSid: typeof targetCall.sid === 'string' ? targetCall.sid : null,
    repCallSid,
  })
}

async function handleUpdateConference(body: UpdateConferenceBody) {
  const { accountSid, authToken } = getTwilioCredentials()
  const action: ConferenceAction = body.action

  if (action === 'complete') {
    await completeCall(accountSid, authToken, body.repCallSid)
    return Response.json({ ok: true, action })
  }

  if (action === 'return') {
    await completeCall(accountSid, authToken, body.targetCallSid)
    return Response.json({ ok: true, action })
  }

  await Promise.all([
    completeCall(accountSid, authToken, body.repCallSid),
    completeCall(accountSid, authToken, body.targetCallSid),
  ])
  return Response.json({ ok: true, action })
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-conference' })
}

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as ConferenceRequestBody
    const action = body.action || 'start'
    if (action === 'start') {
      return handleStartConference(body as StartConferenceBody)
    }
    return handleUpdateConference(body as UpdateConferenceBody)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Conference failed' },
      { status: 500 }
    )
  }
}
