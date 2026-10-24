import { after } from 'next/server'
import { findBlockedCaller, getDialerSettings } from '@/lib/server/dialer-settings'
import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { getSaturnBranchLabel } from '@/lib/sales-phones'
import { sendRepAlertEmail, missedCallNotificationEmail } from '@/lib/server/internal-notifications'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import { persistInboundCallEvent, reserveMissedCallResponse } from '@/lib/server/inbound-call-history'
import { saveInboundLead } from '@/lib/server/sales-repository'

// Twilio calls this action URL when <Dial> completes for ANY reason:
// completed = someone answered, no-answer = nobody answered, busy/failed = other failure
// We update the inbound lead status accordingly so the CRM shows the right thing.

const BUSINESS_NAME = 'Saturn Star Moving'
export const maxDuration = 120

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

async function updateInboundLead(from: string, to: string, callSid: string, patch: Record<string, unknown>) {
  await saveInboundLead({ id: crypto.randomUUID(), source: 'twilio_call', phone: from, message: `Inbound call from ${from}`, raw_data: { from, to, callSid, ...patch } })
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
    const rawBody = await request.text()
    const rejection = await authorizeTwilioWebhook(request, rawBody)
    if (rejection) return rejection
    await captureTwilioInteraction(rawBody, 'twilio_missed_call', 'call')
    const formData = carrierVoiceForm(rawBody)
    const from    = (formData.get('From') as string | null)?.trim() || ''
    if (findBlockedCaller(await getDialerSettings(), from)) return xmlResponse('<Response></Response>')
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

    if (who !== 'nobody') {
      // Call was answered by someone on the team — update CRM to reflect that
      await updateInboundLead(from, to, callSid, {
        missedCall: false,
        answeredAt: now,
        answeredByRep: true,
        dialCallDuration,
        dialCallSid: dialCallSid || undefined,
        answeredCallSid: callSid,
      })
    } else {
      // Nobody answered — mark missed and send auto-text to caller (with dedup)
      await updateInboundLead(from, to, callSid, {
        missedCall: true,
        missedCallAt: now,
        missedCallReason: dialCallStatus || 'no-answer',
        callSid,
      })

      // Return the voicemail prompt promptly; Next keeps this work alive after the response.
      after(async () => {
        try {
          if (await reserveMissedCallResponse(from, businessNumber, callSid)) {
            await processInboundAutomationEvent({
              source: 'missed_call',
              channel: 'sms',
              phone: from,
              message: '',
              receivedAt: now,
              raw: { callSid, from, to, dialCallStatus, missedCall: true },
            }).catch(error => console.error('Missed-call automation failed; staff alert retained', { callSid, error: String(error) }))
          }
        } catch (error) {
          console.error('Missed-call response reservation failed', { callSid, error: String(error) })
        }
        await Promise.all([
          sendRepAlertEmail(`Missed Call — ${from}`, missedCallNotificationEmail(from, branchLabel)),
          persistInboundCallEvent({ source: 'twilio_missed_call', channel: 'call', sender: from, recipient: to, occurredAt: now, raw: rawBody })
            .catch(error => console.error('Inbound call history projection failed', { callSid, error: String(error) })),
        ])
      })
    }
    if (who !== 'nobody') after(() => persistInboundCallEvent({ source: 'twilio_missed_call', channel: 'call', sender: from, recipient: to, occurredAt: now, raw: rawBody }).catch(error => console.error('Inbound call history projection failed', { callSid, error: String(error) })))
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
