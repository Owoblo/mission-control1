import { saveInboundLead } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

// Twilio sends form-encoded data for SMS webhooks
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const from = (formData.get('From') as string | null)?.trim() || ''
    const body = (formData.get('Body') as string | null)?.trim() || ''
    const messageSid = (formData.get('MessageSid') as string | null)?.trim() || ''

    if (from) {
      await saveInboundLead({
        id: uid('inb'),
        source: 'twilio_sms',
        phone: from,
        message: body || 'Inbound SMS (no body)',
        raw_data: {
          messageSid,
          from,
          body,
        },
      })
    }
  } catch {
    // Always return 200 to Twilio — never let errors cause retries
  }

  // Twilio expects TwiML back — empty Response means no auto-reply
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
