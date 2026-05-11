import { requireSupabaseEnv } from '@/lib/server/runtime'
import { sendRepAlertEmail, voicemailNotificationEmail } from '@/lib/server/internal-notifications'

function xmlResponse(twiml: string) {
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}

async function patchInboundLeadVoicemail(
  from: string,
  voicemailUrl: string,
  voicemailDuration: number,
  voicemailAt: string,
) {
  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/inbound_leads?phone=eq.${encodeURIComponent(from)}&order=created_at.desc&limit=1`,
      { headers, cache: 'no-store' }
    )
    const leads = await res.json() as Array<{ id: string; raw_data: Record<string, unknown> }>
    if (!leads[0]) return null
    await fetch(`${url}/rest/v1/inbound_leads?id=eq.${leads[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        raw_data: {
          ...leads[0].raw_data,
          voicemailUrl,
          voicemailDuration,
          voicemailAt,
        },
      }),
    })
    return leads[0].id
  } catch {
    return null
  }
}

export async function GET() {
  return Response.json({ ok: true, route: 'dialer-voicemail' })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const callSid          = (formData.get('CallSid') as string | null)?.trim() || ''
    const recordingUrl     = (formData.get('RecordingUrl') as string | null)?.trim() || ''
    const recordingDuration = parseInt((formData.get('RecordingDuration') as string | null) || '0', 10)
    const from             = (formData.get('From') as string | null)?.trim() || ''
    const to               = (formData.get('To') as string | null)?.trim() || ''

    if (from && recordingUrl) {
      const voicemailAt = new Date().toISOString()

      // Save to Supabase in background — never block TwiML on DB latency
      void (async () => {
        try {
          const leadId = await patchInboundLeadVoicemail(from, recordingUrl, recordingDuration, voicemailAt)
          await sendRepAlertEmail(
            `New Voicemail from ${from}`,
            voicemailNotificationEmail(from, recordingDuration, recordingUrl, leadId)
          )
        } catch {
          // best-effort
        }
      })()
    }

    void callSid
    void to
  } catch {
    // always return valid TwiML
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>`)
}
