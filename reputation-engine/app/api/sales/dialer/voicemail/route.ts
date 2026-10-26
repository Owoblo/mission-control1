import { after } from 'next/server'
import { carrierVoiceForm } from '@/lib/server/carrier-voice'
import { authorizeTwilioWebhook } from '@/lib/server/security'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { getInboundLeadByCallSid, saveInboundLead } from '@/lib/server/sales-repository'
import { persistInboundCallEvent } from '@/lib/server/inbound-call-history'
import { sendRepAlertEmail, voicemailNotificationEmail } from '@/lib/server/internal-notifications'
import { archiveTwilioRecording } from '@/lib/server/recording-archive'
import { getTwilioCredentials } from '@/lib/server/runtime'

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

async function patchInboundLeadVoicemail(
  from: string,
  to: string,
  callSid: string,
  voicemailUrl: string,
  voicemailDuration: number,
  voicemailAt: string,
) {
  try {
    await saveInboundLead({ id: crypto.randomUUID(), source: 'twilio_call', phone: from, message: `Inbound call from ${from}`, raw_data: { from, to, callSid, voicemailUrl, voicemailDuration, voicemailAt } })
    const inbound = await getInboundLeadByCallSid(callSid)
    return typeof inbound?.raw_data === 'object' ? String(inbound.raw_data?.linkedLeadId || '') || null : null
  } catch {
    return null
  }
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-voicemail' })
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const rejection = await authorizeTwilioWebhook(request, rawBody)
    if (rejection) return rejection
    await captureTwilioInteraction(rawBody, 'twilio_voicemail', 'voicemail')
    const formData = carrierVoiceForm(rawBody)
    const callSid          = (formData.get('CallSid') as string | null)?.trim() || ''
    const recordingUrl     = (formData.get('RecordingUrl') as string | null)?.trim() || ''
    const recordingDuration = parseInt((formData.get('RecordingDuration') as string | null) || '0', 10)
    const from             = (formData.get('From') as string | null)?.trim() || ''
    const to               = (formData.get('To') as string | null)?.trim() || ''

    if (from && recordingUrl) {
      const voicemailAt = new Date().toISOString()

      // Save to Supabase in background — never block TwiML on DB latency
      after(async () => {
        try {
          const leadId = await patchInboundLeadVoicemail(from, to, callSid, recordingUrl, recordingDuration, voicemailAt)
          await Promise.all([
            persistInboundCallEvent({ source: 'twilio_voicemail', channel: 'voicemail', sender: from, recipient: to, occurredAt: voicemailAt, raw: rawBody }).then(async mapping => {
              if (!mapping) return
              const { accountSid, authToken } = getTwilioCredentials()
              await archiveTwilioRecording({ ...mapping, accountSid, authToken, callSid, recordingUrl, recordingSid: formData.get('RecordingSid'), durationSeconds: recordingDuration, phoneNumber: from, createdAt: voicemailAt })
            })
              .catch(error => console.error('Voicemail history projection failed', { callSid, error: String(error) })),
            sendRepAlertEmail(`New Voicemail from ${from}`, voicemailNotificationEmail(from, recordingDuration, recordingUrl, leadId), undefined, `voicemail:${formData.get('RecordingSid') || callSid}`),
          ])
        } catch {
          // best-effort
        }
      })
    }

    void callSid
    void to
  } catch {
    // always return valid TwiML
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`)
}
