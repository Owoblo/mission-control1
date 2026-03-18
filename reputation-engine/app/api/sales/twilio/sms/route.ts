import { appendSmsToInboundLead, getInboundLeadByPhone, saveInboundLead } from '@/lib/server/sales-repository'
import { logEvent } from '@/lib/server/analytics'
import { uid } from '@/lib/sales'

// Normalize phone to E.164 for matching (strip formatting)
function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

// Twilio sends form-encoded data for SMS webhooks
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const from = (formData.get('From') as string | null)?.trim() || ''
    const body = (formData.get('Body') as string | null)?.trim() || ''
    const messageSid = (formData.get('MessageSid') as string | null)?.trim() || ''

    if (from) {
      const normalized = toE164(from)

      // Check if there's an existing unclaimed inbound lead from this number.
      // If yes, thread the reply into that lead instead of creating a duplicate.
      const existing = await getInboundLeadByPhone(normalized).catch(() => null)
        ?? await getInboundLeadByPhone(from).catch(() => null)

      if (existing) {
        await appendSmsToInboundLead(existing.id, body || '(no body)', messageSid)
      } else {
        await saveInboundLead({
          id: uid('inb'),
          source: 'twilio_sms',
          phone: normalized || from,
          message: body || 'Inbound SMS (no body)',
          raw_data: {
            messageSid,
            from,
            body,
            smsThread: [{ direction: 'inbound', body: body || '(no body)', messageSid, at: new Date().toISOString() }],
          },
        })
      }
    }
    void logEvent('sms_received', {
      properties: {
        channel: 'sms',
        message_direction: 'inbound',
        message_length: body?.length || 0,
      },
    })
  } catch {
    // Always return 200 to Twilio — never let errors cause retries
  }

  // Twilio expects TwiML back — empty Response means no auto-reply
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
