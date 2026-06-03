import { getTwilioCredentials, requireSupabaseEnv, getAppBaseUrl } from '@/lib/server/runtime'
import { outboundSmsRecentlySent, recordOutboundSmsToSupabase } from '@/lib/server/sales-messaging'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { getSaturnBranchLabel } from '@/lib/sales-phones'
import { sendRepAlertEmail, missedCallNotificationEmail } from '@/lib/server/internal-notifications'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'

// Twilio calls this action URL when <Dial> completes for ANY reason:
// completed = someone answered, no-answer = nobody answered, busy/failed = other failure
// We update the inbound lead status accordingly so the CRM shows the right thing.

const BUSINESS_NAME = 'Saturn Star Moving'
const SMS_COOLDOWN_MS = 5 * 60 * 1000  // don't send duplicate missed-call SMS within 5 min

// In-memory cooldown — resets on cold start but good enough for dedup within a session
const recentMissedSmsSent = new Map<string, number>()

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

async function sendSms(accountSid: string, authToken: string, to: string, from: string, body: string) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuth(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  })

  const payload = await response.json().catch(() => ({})) as { sid?: string; message?: string }
  if (!response.ok || !payload.sid) {
    throw new Error(payload.message || 'Missed-call SMS failed')
  }

  return payload.sid
}

async function updateInboundLead(from: string, patch: Record<string, unknown>) {
  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/inbound_leads?phone=eq.${encodeURIComponent(from)}&order=created_at.desc&limit=1`,
      { headers, cache: 'no-store' }
    )
    const leads = await res.json() as Array<{ id: string; raw_data: Record<string, unknown> }>
    if (!leads[0]) return
    await fetch(`${url}/rest/v1/inbound_leads?id=eq.${leads[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ raw_data: { ...leads[0].raw_data, ...patch } }),
    })
  } catch { /* non-fatal */ }
}

function answeredBy(dialCallStatus: string, dialCallDuration: number): 'browser' | 'rep' | 'nobody' {
  if (dialCallStatus !== 'completed' || dialCallDuration === 0) return 'nobody'
  // We can't know from Twilio alone if browser or SIP answered — but if the browser
  // answered, it logs via finalizeCall on the client side. We optimistically mark as
  // 'rep' here (meaning someone on the team answered). The browser will overwrite
  // if it was the browser client that connected.
  return 'rep'
}

export async function POST(request: Request) {
  let whoResult: 'browser' | 'rep' | 'nobody' = 'nobody'

  try {
    const formData = await request.formData()
    const from    = (formData.get('From') as string | null)?.trim() || ''
    const to      = (formData.get('To') as string | null)?.trim() || ''
    const callSid = (formData.get('CallSid') as string | null)?.trim() || ''
    const dialCallStatus   = (formData.get('DialCallStatus') as string | null)?.trim() || ''
    const dialCallDuration = parseInt((formData.get('DialCallDuration') as string | null) || '0', 10)
    const dialCallSid      = (formData.get('DialCallSid') as string | null)?.trim() || ''

    if (!from || from.toLowerCase().startsWith('client:')) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)
    }

    const who = answeredBy(dialCallStatus, dialCallDuration)
    whoResult = who
    const now = new Date().toISOString()
    const branchLabel   = getSaturnBranchLabel(to) || BUSINESS_NAME
    const businessNumber = to || '+12267732993'

    // Dedup: don't send missed-call SMS to same number twice within cooldown window
    const lastSent = recentMissedSmsSent.get(from) || 0
    const withinCooldown = (Date.now() - lastSent) < SMS_COOLDOWN_MS

    if (who !== 'nobody') {
      // Call was answered by someone on the team — update CRM to reflect that
      void updateInboundLead(from, {
        missedCall: false,
        answeredAt: now,
        answeredByRep: true,
        dialCallDuration,
        dialCallSid: dialCallSid || undefined,
        answeredCallSid: callSid,
      }).catch(() => {})
    } else {
      // Nobody answered — mark missed and send auto-text to caller (with dedup)
      void updateInboundLead(from, {
        missedCall: true,
        missedCallAt: now,
        missedCallReason: dialCallStatus || 'no-answer',
        callSid,
      }).catch(() => {})

      const recentlySent = await outboundSmsRecentlySent({
        to: from,
        from: businessNumber,
      }).catch(() => false)

      if (!withinCooldown && !recentlySent) {
        recentMissedSmsSent.set(from, Date.now())

        // Fire automation — it picks up context from any existing lead and sends a
        // proper response (quote, info collection, etc.) instead of a generic text.
        const automationHandled = await processInboundAutomationEvent({
          source: 'missed_call',
          channel: 'sms',
          phone: from,
          message: '',
          receivedAt: now,
          raw: { callSid, from, to, dialCallStatus, missedCall: true },
        }).then(() => true).catch(() => false)

        // Fallback only if automation fails entirely
        if (!automationHandled) {
          const { accountSid, authToken } = getTwilioCredentials()
          const callerSms = `Hi! You just called Saturn Star Moving. We missed you — reply here to get a moving estimate or we'll call you right back.`
          void sendSms(accountSid, authToken, from, businessNumber, callerSms)
            .then(sid => recordOutboundSmsToSupabase(businessNumber, from, callerSms, undefined, sid))
            .catch(() => {})
        }
      }

      void sendRepAlertEmail(
        `Missed Call — ${from}`,
        missedCallNotificationEmail(from, branchLabel)
      )
    }
  } catch { /* always return valid TwiML */ }

  // If nobody answered, offer voicemail prompt
  if (whoResult === 'nobody') {
    const appUrl = getAppBaseUrl()
    const voicemailUrl = appUrl ? `${appUrl}/api/sales/dialer/voicemail` : ''
    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Say voice="alice">We missed your call! Please leave a short message and Saturn Star Moving will call you right back.</Say>` +
      (voicemailUrl ? `<Record maxLength="90" playBeep="true" action="${voicemailUrl}" method="POST" />` : '') +
      `<Say voice="alice">No message received. Please try again or send us a text. Goodbye!</Say>` +
      `<Hangup />` +
      `</Response>`
    )
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-call-completion' })
}
