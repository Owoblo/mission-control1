import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnTrackingLabel,
  getSaturnTrackingSource,
} from '@/lib/sales-phones'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { appendSmsToInboundLead, getInboundLeadByPhone, saveInboundLead } from '@/lib/server/sales-repository'
import { getAppBaseUrl, getWorkerSharedSecret, requireSupabaseEnv } from '@/lib/server/runtime'
import { logEvent } from '@/lib/server/analytics'

function triggerIntelligence(leadId: string) {
  const base = getAppBaseUrl()
  const secret = getWorkerSharedSecret()
  if (!base || !secret || !leadId) return
  void fetch(`${base}/api/sales/leads/${leadId}/intelligence`, {
    method: 'POST',
    headers: { 'x-internal-secret': secret },
  }).catch(() => {})
}

const MY_NUMBER = DEFAULT_SATURN_BRANCH_NUMBER

export async function GET() {
  return Response.json({
    ok: true,
    route: 'sales-twilio-sms',
    checks: ['sms-webhook', 'thread-writeback'],
  })
}

// Normalize phone to E.164 for matching (strip formatting)
function toE164(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

// Write to sms_messages table so the HTML CRM inbox can show the thread
async function writeSmsMessage(from: string, toNumber: string, body: string, messageSid: string, leadId?: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        from_number: from,
        to_number: toNumber || MY_NUMBER,
        body,
        direction: 'inbound',
        lead_id: leadId ?? null,
        twilio_sid: messageSid || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal — inbox still works from inbound_leads
  }
}

// Twilio sends form-encoded data for SMS and WhatsApp webhooks
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const rawFrom = (formData.get('From') as string | null)?.trim() || ''
    const rawTo = (formData.get('To') as string | null)?.trim() || MY_NUMBER
    const body = (formData.get('Body') as string | null)?.trim() || ''
    const messageSid = (formData.get('MessageSid') as string | null)?.trim() || ''
    const receivedAt = new Date().toISOString()

    // Strip WhatsApp prefix for phone matching — channel is detected from SID (WA=WhatsApp, SM=SMS)
    const from = rawFrom.replace(/^whatsapp:/i, '')
    const toField = rawTo.replace(/^whatsapp:/i, '') || MY_NUMBER

    if (from) {
      const normalized = toE164(from)
      const partnership = await pausePartnershipSequenceForInbound({
        channel: 'sms',
        phone: normalized || from,
        occurredAt: receivedAt,
        notes: body ? `Inbound SMS: ${body}` : 'Inbound SMS reply received',
        metadata: {
          from,
          to: toField,
          messageSid,
        },
      }).catch(() => ({ matched: false as const }))

      if (!partnership.matched) {

        // Check if there's an existing unclaimed inbound lead from this number.
        // If yes, thread the reply into that lead instead of creating a duplicate.
        const existing = await getInboundLeadByPhone(normalized).catch(() => null)
          ?? await getInboundLeadByPhone(from).catch(() => null)

        const inboundLeadId = existing?.id || crypto.randomUUID()

        if (existing) {
          await appendSmsToInboundLead(inboundLeadId, body || '(no body)', messageSid)
        } else {
          const trackingLabel = getSaturnTrackingLabel(toField)
          const trackingSource = getSaturnTrackingSource(toField)
          await saveInboundLead({
            id: inboundLeadId,
            source: 'twilio_sms',
            phone: normalized || from,
            message: body || 'Inbound SMS (no body)',
            raw_data: {
              messageSid,
              from,
              to: toField,
              body,
              trackingLabel: trackingLabel || undefined,
              trackingSource: trackingSource || undefined,
              smsThread: [{ direction: 'inbound', body: body || '(no body)', messageSid, at: receivedAt }],
            },
          })
        }

        const automation = await processInboundAutomationEvent({
          inboundLeadId,
          source: 'twilio_sms',
          channel: 'sms',
          phone: normalized || from,
          message: body || '(no body)',
          receivedAt,
          raw: { messageSid, from, body },
        }).catch(() => null)

        const resolvedLeadId = automation?.lead?.id
        void writeSmsMessage(normalized || from, toField, body || '(no body)', messageSid, resolvedLeadId)
        if (resolvedLeadId) triggerIntelligence(resolvedLeadId)
      }
    }
    void logEvent('sms_received', {
      actorName: 'Customer',
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
