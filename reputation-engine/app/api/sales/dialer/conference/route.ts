import { getAppBaseUrl, getTwilioCredentials } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { pickSaturnBranchPhoneNumber } from '@/lib/sales-phones'
import {
  escapeTwiml,
  isSafeConferenceName,
  isTwilioCallSid,
  makeConferenceName,
  normalizeInternalTransferTarget,
  resolveTwilioCallLegs,
  type TwilioCallLeg,
} from '@/lib/twilio-call-control'

type ConferenceAction = 'start' | 'join' | 'complete' | 'return' | 'end' | 'hold' | 'resume'

type StartConferenceBody = {
  action?: 'start'
  activeCallSid?: string
  customerCallSid?: string // backwards-compatible client field
  addTarget?: string
  holdOnly?: boolean
  callerId?: string | null
}

type UpdateConferenceBody = {
  action: Exclude<ConferenceAction, 'start'>
  conferenceName?: string
  targetCallSid?: string
  repCallSid?: string
  customerCallSid?: string
}

type ConferenceRequestBody = StartConferenceBody | UpdateConferenceBody

function conferenceTwiml(input: {
  conferenceName: string
  participantLabel: string
  callSidForRecording?: string
  announce?: string
}) {
  const appUrl = getAppBaseUrl()
  const callbackUrl = `${appUrl}/api/sales/dialer/conference/events`
  const recordingCallback = input.callSidForRecording
    ? `${appUrl}/api/sales/dialer/recording-callback?callSid=${encodeURIComponent(input.callSidForRecording)}`
    : ''
  const announce = input.announce
    ? `<Say voice="alice">${escapeTwiml(input.announce)}</Say>`
    : ''
  const conferenceAttrs = [
    `endConferenceOnExit="false"`,
    `startConferenceOnEnter="true"`,
    `beep="false"`,
    `muted="false"`,
    `participantLabel="${escapeTwiml(input.participantLabel)}"`,
    `statusCallback="${escapeTwiml(callbackUrl)}"`,
    `statusCallbackMethod="POST"`,
    `statusCallbackEvent="start end join leave mute hold modify"`,
    input.callSidForRecording ? `record="record-from-start"` : '',
    recordingCallback ? `recordingStatusCallback="${escapeTwiml(recordingCallback)}"` : '',
    recordingCallback ? `recordingStatusCallbackMethod="POST"` : '',
    recordingCallback ? `recordingStatusCallbackEvent="completed absent"` : '',
  ].filter(Boolean).join(' ')
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${announce}<Dial><Conference ${conferenceAttrs}>${escapeTwiml(input.conferenceName)}</Conference></Dial></Response>`
}

async function twilioRequest(
  accountSid: string,
  authToken: string,
  path: string,
  options?: { method?: 'GET' | 'POST'; body?: Record<string, string> },
) {
  const method = options?.method || 'GET'
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    method,
    headers: {
      Authorization: twilioAuth(accountSid, authToken),
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(method === 'POST' ? { body: new URLSearchParams(options?.body || {}).toString() } : {}),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(payload.message || `Twilio error ${response.status}`))
  return payload
}

async function resolveActiveCallLegs(accountSid: string, authToken: string, activeCallSid: string) {
  if (!isTwilioCallSid(activeCallSid)) throw new Error('Invalid active Call SID')
  const active = await twilioRequest(accountSid, authToken, `/Calls/${activeCallSid}.json`) as TwilioCallLeg
  const related: TwilioCallLeg[] = []

  if (active.parent_call_sid && isTwilioCallSid(active.parent_call_sid)) {
    related.push(
      await twilioRequest(accountSid, authToken, `/Calls/${active.parent_call_sid}.json`) as TwilioCallLeg,
    )
  } else {
    const query = new URLSearchParams({ ParentCallSid: activeCallSid, PageSize: '20' })
    const result = await twilioRequest(accountSid, authToken, `/Calls.json?${query.toString()}`) as {
      calls?: TwilioCallLeg[]
    }
    related.push(...(result.calls || []))
  }

  return resolveTwilioCallLegs(active, related)
}

async function updateCall(
  accountSid: string,
  authToken: string,
  callSid: string,
  body: Record<string, string>,
) {
  if (!isTwilioCallSid(callSid)) throw new Error('Invalid Call SID')
  return twilioRequest(accountSid, authToken, `/Calls/${callSid}.json`, { method: 'POST', body })
}

async function findConferenceSid(
  accountSid: string,
  authToken: string,
  conferenceName: string,
) {
  if (!isSafeConferenceName(conferenceName)) throw new Error('Invalid conference name')
  const query = new URLSearchParams({ FriendlyName: conferenceName, Status: 'in-progress', PageSize: '1' })
  const result = await twilioRequest(accountSid, authToken, `/Conferences.json?${query.toString()}`) as {
    conferences?: Array<{ sid?: string }>
  }
  const sid = result.conferences?.[0]?.sid
  if (!sid) throw new Error('Conference is not active yet')
  return sid
}

async function setParticipantHold(input: {
  accountSid: string
  authToken: string
  conferenceName: string
  customerCallSid: string
  hold: boolean
}) {
  if (!isTwilioCallSid(input.customerCallSid)) throw new Error('Invalid customer Call SID')
  const conferenceSid = await findConferenceSid(input.accountSid, input.authToken, input.conferenceName)
  const body: Record<string, string> = { Hold: input.hold ? 'true' : 'false' }
  if (input.hold) {
    body.HoldUrl = `${getAppBaseUrl()}/api/sales/dialer/conference/hold`
    body.HoldMethod = 'GET'
  }
  await twilioRequest(
    input.accountSid,
    input.authToken,
    `/Conferences/${conferenceSid}/Participants/${input.customerCallSid}.json`,
    { method: 'POST', body },
  )
}

async function completeCall(accountSid: string, authToken: string, callSid?: string | null) {
  if (!callSid || !isTwilioCallSid(callSid)) return null
  return updateCall(accountSid, authToken, callSid, { Status: 'completed' }).catch(() => null)
}

async function handleStartConference(body: StartConferenceBody) {
  const activeCallSid = body.activeCallSid || body.customerCallSid
  if (!activeCallSid || (!body.addTarget && !body.holdOnly)) {
    return Response.json({ error: 'activeCallSid and a transfer target or holdOnly are required' }, { status: 400 })
  }

  const { accountSid, authToken } = getTwilioCredentials()
  const legs = await resolveActiveCallLegs(accountSid, authToken, activeCallSid)
  const conferenceName = makeConferenceName(legs.rootCallSid)
  const callerId = pickSaturnBranchPhoneNumber(body.callerId)

  // The external customer is the child of the browser rep's <Dial> on outbound
  // calls. Redirecting the rep first tears down that child leg, leaving no live
  // customer call for the second update. Move the customer into the conference
  // first; the child remains alive there while the rep follows immediately.
  await updateCall(accountSid, authToken, legs.customerCallSid, {
    Twiml: conferenceTwiml({
      conferenceName,
      participantLabel: `customer_${legs.customerCallSid}`,
    }),
  })
  await updateCall(accountSid, authToken, legs.repCallSid, {
    Twiml: conferenceTwiml({
      conferenceName,
      participantLabel: `rep_${legs.repCallSid}`,
      callSidForRecording: legs.customerCallSid,
    }),
  })

  // The customer hears hold music while the original rep privately briefs the manager.
  // A short retry handles the conference taking a moment to become queryable.
  let held = false
  for (let attempt = 0; attempt < 3 && !held; attempt += 1) {
    try {
      await setParticipantHold({
        accountSid,
        authToken,
        conferenceName,
        customerCallSid: legs.customerCallSid,
        hold: true,
      })
      held = true
    } catch {
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  if (!held) throw new Error('Transfer bridge started, but the customer could not be placed on hold')

  // Only ring the teammate after hold is confirmed. This prevents the customer
  // from hearing the consultation invitation or the beginning of the private brief.
  let targetCallSid: string | null = null
  if (body.addTarget) {
    const normalizedTarget = normalizeInternalTransferTarget(body.addTarget)
    const targetCall = await twilioRequest(accountSid, authToken, '/Calls.json', {
      method: 'POST',
      body: {
        From: callerId,
        To: normalizedTarget.kind === 'client' ? `client:${normalizedTarget.target}` : normalizedTarget.target,
        Twiml: conferenceTwiml({
          conferenceName,
          participantLabel: `manager_${Date.now()}`,
          announce: 'You are joining a private transfer consultation.',
        }),
        StatusCallback: `${getAppBaseUrl()}/api/sales/dialer/conference/events`,
        StatusCallbackMethod: 'POST',
        StatusCallbackEvent: 'initiated ringing answered completed',
      },
    })
    targetCallSid = typeof targetCall.sid === 'string' ? targetCall.sid : null
  }

  return Response.json({
    ok: true,
    conferenceName,
    customerCallSid: legs.customerCallSid,
    targetCallSid,
    repCallSid: legs.repCallSid,
    customerOnHold: true,
    mode: body.holdOnly ? 'hold' : 'consult',
  })
}

async function handleUpdateConference(body: UpdateConferenceBody) {
  const { accountSid, authToken } = getTwilioCredentials()
  const action = body.action
  if (!body.conferenceName || !isSafeConferenceName(body.conferenceName)) {
    return Response.json({ error: 'A valid conferenceName is required' }, { status: 400 })
  }

  if (action === 'hold' || action === 'resume') {
    if (!body.customerCallSid) {
      return Response.json({ error: 'customerCallSid is required' }, { status: 400 })
    }
    await setParticipantHold({
      accountSid,
      authToken,
      conferenceName: body.conferenceName,
      customerCallSid: body.customerCallSid,
      hold: action === 'hold',
    })
    return Response.json({ ok: true, action })
  }

  if (action === 'join') {
    if (!body.customerCallSid) {
      return Response.json({ error: 'customerCallSid is required' }, { status: 400 })
    }
    await setParticipantHold({
      accountSid,
      authToken,
      conferenceName: body.conferenceName,
      customerCallSid: body.customerCallSid,
      hold: false,
    })
    return Response.json({ ok: true, action })
  }

  if (action === 'complete') {
    if (body.customerCallSid) {
      await setParticipantHold({
        accountSid,
        authToken,
        conferenceName: body.conferenceName,
        customerCallSid: body.customerCallSid,
        hold: false,
      })
    }
    await completeCall(accountSid, authToken, body.repCallSid)
    return Response.json({ ok: true, action })
  }

  if (action === 'return') {
    await completeCall(accountSid, authToken, body.targetCallSid)
    if (body.customerCallSid) {
      await setParticipantHold({
        accountSid,
        authToken,
        conferenceName: body.conferenceName,
        customerCallSid: body.customerCallSid,
        hold: false,
      })
    }
    return Response.json({ ok: true, action })
  }

  await Promise.all([
    completeCall(accountSid, authToken, body.repCallSid),
    completeCall(accountSid, authToken, body.targetCallSid),
    completeCall(accountSid, authToken, body.customerCallSid),
  ])
  return Response.json({ ok: true, action })
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-conference', actions: ['start', 'hold', 'resume', 'join', 'complete', 'return', 'end'] })
}

export async function POST(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session || !['owner', 'manager', 'sales_rep', 'partnership_manager'].includes(session.role || '')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json() as ConferenceRequestBody
    return (body.action || 'start') === 'start'
      ? handleStartConference(body as StartConferenceBody)
      : handleUpdateConference(body as UpdateConferenceBody)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Conference call control failed' },
      { status: 502 },
    )
  }
}
