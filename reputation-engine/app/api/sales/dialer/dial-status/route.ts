import { getInboundLeadByCallSid } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

// Twilio calls this URL after the <Dial> verb completes (action attribute).
// DialCallStatus = completed|busy|no-answer|failed|canceled
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const callSid = (formData.get('CallSid') as string | null)?.trim()
    const dialCallStatus = (formData.get('DialCallStatus') as string | null)?.trim() || ''
    const from = (formData.get('From') as string | null)?.trim() || ''

    const answered = dialCallStatus === 'completed' || dialCallStatus === 'answered'

    if (!answered && callSid) {
      const lead = await getInboundLeadByCallSid(callSid).catch(() => null)
      if (lead) {
        const { url, headers } = requireSupabaseEnv()
        const raw = typeof lead.raw_data === 'object' && lead.raw_data
          ? (lead.raw_data as Record<string, unknown>)
          : {}

        await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(lead.id)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            message: `Missed call from ${from || lead.phone || 'unknown number'}`,
            raw_data: {
              ...raw,
              missedCall: true,
              dialCallStatus,
              missedAt: new Date().toISOString(),
            },
          }),
        })
      }
    }
  } catch {
    // best-effort — never block Twilio
  }

  // Twilio needs valid TwiML back after the action callback
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
