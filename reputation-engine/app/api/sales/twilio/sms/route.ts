import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnTrackingLabel,
  getSaturnTrackingSource,
} from '@/lib/sales-phones'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { appendSmsToInboundLead, getInboundLeadByPhone, saveInboundLead } from '@/lib/server/sales-repository'
import { getAppBaseUrl, getWorkerSharedSecret, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { logEvent } from '@/lib/server/analytics'
import { sendRepAlertEmail, smsNotificationEmail } from '@/lib/server/internal-notifications'
import { persistInboundMmsToLead } from '@/lib/server/lead-media'
import { verifyTwilioSignature } from '@/lib/server/security'

type TwilioMessageLookup = {
  sid?: string
  from?: string
  to?: string
  body?: string
  direction?: string
  account_sid?: string
}

function stripTwilioChannelPrefix(value: string) {
  return value.replace(/^whatsapp:/i, '').trim()
}

function normalizeTwilioBody(value: string | null) {
  return (value || '').replace(/\r\n/g, '\n').trim()
}

function extractTwilioMedia(formData: URLSearchParams) {
  const count = Number(formData.get('NumMedia') || 0) || 0
  const media: Array<{ url: string; contentType?: string }> = []

  for (let index = 0; index < count; index += 1) {
    const url = (formData.get(`MediaUrl${index}`) || '').trim()
    const contentType = (formData.get(`MediaContentType${index}`) || '').trim()
    if (!url) continue
    media.push({ url, ...(contentType ? { contentType } : {}) })
  }

  return media
}

async function fetchTwilioMessageBySid(messageSid: string) {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const authToken = readEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) return null

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${encodeURIComponent(messageSid)}.json`,
      {
        headers: {
          Authorization: twilioAuth(accountSid, authToken),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!response.ok) return null
    return response.json() as Promise<TwilioMessageLookup>
  } catch {
    return null
  }
}

async function verifyTwilioMessageSidFallback(formData: URLSearchParams): Promise<boolean> {
  const accountSid = readEnv('TWILIO_ACCOUNT_SID')
  const inboundAccountSid = (formData.get('AccountSid') ?? '').trim()
  const messageSid = (formData.get('MessageSid') ?? formData.get('SmsSid') ?? '').trim()
  const from = stripTwilioChannelPrefix((formData.get('From') ?? '').trim())
  const to = stripTwilioChannelPrefix((formData.get('To') ?? '').trim())
  const body = normalizeTwilioBody(formData.get('Body'))

  if (!accountSid || !messageSid || !from || !to) return false
  if (inboundAccountSid && inboundAccountSid !== accountSid) return false

  const twilioMessage = await fetchTwilioMessageBySid(messageSid)
  if (!twilioMessage?.sid || twilioMessage.sid !== messageSid) return false
  if (twilioMessage.account_sid && twilioMessage.account_sid !== accountSid) return false
  if (!twilioMessage.direction?.startsWith('inbound')) return false

  return (
    stripTwilioChannelPrefix(twilioMessage.from || '') === from &&
    stripTwilioChannelPrefix(twilioMessage.to || '') === to &&
    normalizeTwilioBody(twilioMessage.body ?? '') === body
  )
}

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

// Write to sms_messages table so the HTML CRM inbox can show the thread.
// Await this in the webhook; Vercel may freeze fire-and-forget work after
// returning TwiML.
async function writeSmsMessage(from: string, toNumber: string, body: string, messageSid: string, leadId?: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    if (messageSid) {
      const existingResponse = await fetch(
        `${url}/rest/v1/sms_messages?select=id&twilio_sid=eq.${encodeURIComponent(messageSid)}&limit=1`,
        { headers, cache: 'no-store' }
      )
      if (existingResponse.ok) {
        const existing = (await existingResponse.json()) as Array<{ id: string }>
        if (existing.length > 0) return
      }
    }

    const response = await fetch(`${url}/rest/v1/sms_messages`, {
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
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`sms_messages insert failed: ${detail || response.status}`)
    }
  } catch (error) {
    console.error('Failed to write inbound SMS to CRM thread', error)
    throw error
  }
}

// Twilio sends form-encoded data for SMS and WhatsApp webhooks
export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const formData = new URLSearchParams(rawBody)
    const internalSecret = request.headers.get('x-internal-secret')
    const isHealthCheck = request.headers.get('x-health-check') === '1' && internalSecret === getWorkerSharedSecret()
    const signatureValid = isHealthCheck ? false : await verifyTwilioSignature(request, rawBody)
    const sidFallbackValid = isHealthCheck || signatureValid ? false : await verifyTwilioMessageSidFallback(formData)
    if (!isHealthCheck && !signatureValid && !sidFallbackValid) {
      return new Response('Forbidden', { status: 403 })
    }

    const rawFrom = (formData.get('From') ?? '').trim()
    const rawTo = (formData.get('To') ?? '').trim() || MY_NUMBER
    const body = (formData.get('Body') ?? '').trim()
    const messageSid = (formData.get('MessageSid') ?? formData.get('SmsSid') ?? '').trim()
    const receivedAt = new Date().toISOString()
    const media = extractTwilioMedia(formData)
    const mediaUrls = media.map(item => item.url).filter(Boolean)
    const mediaNote = mediaUrls.length > 0 ? `\n[MMS: ${mediaUrls.join(', ')}]` : ''
    const messageText = `${body || (media.length > 0 ? `Inbound MMS (${media.length} attachment${media.length === 1 ? '' : 's'})` : '(no body)')}${mediaNote}`.trim()

    // Strip WhatsApp prefix for phone matching — channel is detected from SID (WA=WhatsApp, SM=SMS)
    const from = stripTwilioChannelPrefix(rawFrom)
    const toField = stripTwilioChannelPrefix(rawTo) || MY_NUMBER
    const normalized = from ? toE164(from) : ''

    if (isHealthCheck) {
      await writeSmsMessage(normalized || from || '+15550001111', toField, messageText, messageSid || `HC_SMS_${Date.now()}`)
      return Response.json({ ok: true, healthCheck: true, twilioSid: messageSid || null })
    }

    if (from) {
      const partnership = await pausePartnershipSequenceForInbound({
        channel: 'sms',
        phone: normalized || from,
        occurredAt: receivedAt,
        notes: body ? `Inbound SMS: ${messageText}` : messageText,
        metadata: {
          from,
          to: toField,
          messageSid,
          numMedia: media.length,
          media: media.length > 0 ? media : undefined,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        },
      }).catch(() => ({ matched: false as const }))

      if (!partnership.matched) {

        // Check if there's an existing unclaimed inbound lead from this number.
        // If yes, thread the reply into that lead instead of creating a duplicate.
        const existing = await getInboundLeadByPhone(normalized).catch(() => null)
          ?? await getInboundLeadByPhone(from).catch(() => null)

        const inboundLeadId = existing?.id || crypto.randomUUID()

        if (existing) {
          await appendSmsToInboundLead(inboundLeadId, messageText, messageSid, media)
        } else {
          const trackingLabel = getSaturnTrackingLabel(toField)
          const trackingSource = getSaturnTrackingSource(toField)
          await saveInboundLead({
            id: inboundLeadId,
            source: 'twilio_sms',
            phone: normalized || from,
            message: messageText,
            raw_data: {
              messageSid,
              from,
              to: toField,
              body,
              numMedia: media.length,
              media: media.length > 0 ? media : undefined,
              trackingLabel: trackingLabel || undefined,
              trackingSource: trackingSource || undefined,
              smsThread: [{
                direction: 'inbound',
                body: messageText,
                messageSid,
                at: receivedAt,
                ...(media.length > 0 ? { media } : {}),
              }],
            },
          })
        }

        const automation = await processInboundAutomationEvent({
          inboundLeadId,
          source: 'twilio_sms',
          channel: 'sms',
          phone: normalized || from,
          message: messageText,
          receivedAt,
          raw: { messageSid, from, to: toField, body, numMedia: media.length, media },
        }).catch(() => null)

        const resolvedLeadId = automation?.lead?.id
        if (resolvedLeadId && media.length > 0 && automation?.lead) {
          void persistInboundMmsToLead({
            lead: automation.lead,
            media,
            messageSid,
          }).catch(() => {})
        }
        await writeSmsMessage(normalized || from, toField, messageText, messageSid, resolvedLeadId)
        if (resolvedLeadId) triggerIntelligence(resolvedLeadId)
        void sendRepAlertEmail(
          `New SMS from ${from}`,
          smsNotificationEmail(from, messageText, resolvedLeadId)
        )
      }
    }
    void logEvent('sms_received', {
        actorName: 'Customer',
      properties: {
        channel: 'sms',
        message_direction: 'inbound',
        message_length: messageText.length,
        media_count: media.length,
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
