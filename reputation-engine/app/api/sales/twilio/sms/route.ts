import { handleInboundSms } from '@/lib/server/inbound-sms'
import { captureTwilioInteraction } from '@/lib/server/interactions'
import { isAutomatedLeasingNotice, needsPartnershipRoutingReview, savePartnershipRoutingReview } from '@/lib/server/partnership-routing-review'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnTrackingLabel,
  getSaturnTrackingSource,
} from '@/lib/sales-phones'
import { getSalesSmsReplyLeadId } from '@/lib/server/partnership-message-context'
import { notifyPartnershipCustomerContact, pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
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

    return handleInboundSms(formData, isHealthCheck)
  } catch (error) {
    console.error('[sales-twilio-sms] Inbound processing failed', error)
    return new Response('Unable to preserve inbound message', { status: 503 })
  }

  // Twilio expects TwiML back — empty Response means no auto-reply
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
