import { appendSmsToInboundLead, getInboundLeadByPhone, saveInboundLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { logEvent } from '@/lib/server/analytics'
import { generateSmsBotReply } from '@/lib/server/call-intelligence'
import { uid } from '@/lib/sales'

const MY_NUMBER = '+12267732993'

function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

function twimlReply(message: string) {
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

function twimlEmpty() {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}

// Read recent SMS messages for a phone number from sms_messages table
async function getRecentSmsThread(phone: string): Promise<Array<{ direction: 'inbound' | 'outbound'; body: string; createdAt: string }>> {
  try {
    const { url, headers } = requireSupabaseEnv()
    const normalized = toE164(phone)

    // Query messages where this phone is either sender or recipient
    const res = await fetch(
      `${url}/rest/v1/sms_messages?select=from_number,to_number,body,direction,created_at&or=(from_number.eq.${encodeURIComponent(normalized)},to_number.eq.${encodeURIComponent(normalized)})&order=created_at.desc&limit=20`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{ from_number: string; to_number: string; body: string; direction: string; created_at: string }>
    return rows
      .reverse() // oldest first
      .map(r => ({ direction: r.direction as 'inbound' | 'outbound', body: r.body, createdAt: r.created_at }))
  } catch {
    return []
  }
}

// Write outbound SMS to sms_messages so the thread appears in inbox
async function writeOutboundSmsMessage(to: string, body: string, leadId?: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: uid('sms'),
        from_number: MY_NUMBER,
        to_number: to,
        body,
        direction: 'outbound',
        lead_id: leadId ?? null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal
  }
}

async function writeInboundSmsMessage(from: string, body: string, messageSid: string, leadId?: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: uid('sms'),
        from_number: from,
        to_number: MY_NUMBER,
        body,
        direction: 'inbound',
        lead_id: leadId ?? null,
        twilio_sid: messageSid || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal
  }
}

export async function POST(request: Request) {
  let leadId: string | undefined

  try {
    const formData = await request.formData()
    const from = (formData.get('From') as string | null)?.trim() || ''
    const body = (formData.get('Body') as string | null)?.trim() || ''
    const messageSid = (formData.get('MessageSid') as string | null)?.trim() || ''

    if (!from) return twimlEmpty()

    const normalized = toE164(from)

    // Save inbound message to inbound_leads and sms_messages
    const existing = await getInboundLeadByPhone(normalized).catch(() => null)
      ?? await getInboundLeadByPhone(from).catch(() => null)

    if (existing) {
      leadId = existing.id
      await appendSmsToInboundLead(existing.id, body || '(no body)', messageSid)
      void writeInboundSmsMessage(normalized || from, body || '(no body)', messageSid, existing.id)
    } else {
      const newLead = await saveInboundLead({
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
      }).catch(() => null)
      leadId = newLead?.id
      void writeInboundSmsMessage(normalized || from, body || '(no body)', messageSid, leadId)
    }

    void logEvent('sms_received', {
      properties: { channel: 'sms', message_direction: 'inbound', message_length: body?.length || 0 },
    })

    // ── Smart bot reply ────────────────────────────────────────────────────
    // Read conversation history (includes the message we just wrote)
    const thread = await getRecentSmsThread(normalized || from)

    // Find most recent outbound message timestamp for dedup check
    const lastOutbound = [...thread].reverse().find(m => m.direction === 'outbound')
    const lastOutboundAt = lastOutbound?.createdAt ?? null

    // Generate context-aware reply (returns null = stay silent)
    const reply = await generateSmsBotReply(body || '', thread, lastOutboundAt).catch(() => null)

    if (reply) {
      // Log the outbound reply so future messages see it in thread history
      void writeOutboundSmsMessage(normalized || from, reply, leadId)
      return twimlReply(reply)
    }

  } catch {
    // Always return 200 to Twilio — never error out
  }

  return twimlEmpty()
}
