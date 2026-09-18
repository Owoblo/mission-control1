import { NextResponse } from 'next/server'
import { createVerify } from 'node:crypto'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'

export const dynamic = 'force-dynamic'

type SesMessage = {
  eventType?: string
  mail?: {
    messageId?: string
    timestamp?: string
    destination?: string[]
    tags?: Record<string, string[]>
    commonHeaders?: { subject?: string; from?: string[]; to?: string[] }
  }
  bounce?: { bouncedRecipients?: Array<{ emailAddress?: string }>; bounceType?: string; bounceSubType?: string }
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }>; complaintFeedbackType?: string }
  delivery?: { recipients?: string[]; timestamp?: string }
  open?: { timestamp?: string; ipAddress?: string; userAgent?: string }
  click?: { timestamp?: string; ipAddress?: string; userAgent?: string; link?: string }
  subscription?: { contactList?: string; topic?: string; source?: string }
}

type SnsEnvelope = {
  Type?: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  Message?: string
  MessageId?: string
  Subject?: string
  Timestamp?: string
  TopicArn?: string
  Token?: string
  SubscribeURL?: string
  Signature?: string
  SignatureVersion?: '1' | '2'
  SigningCertURL?: string
}

function snsSigningString(envelope: SnsEnvelope) {
  const fields = envelope.Type === 'Notification'
    ? ['Message', 'MessageId', ...(envelope.Subject ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return fields.map(field => `${field}\n${String(envelope[field as keyof SnsEnvelope] || '')}\n`).join('')
}

function allowedSnsCertificate(urlText: string) {
  try {
    const url = new URL(urlText)
    return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname) && url.pathname.endsWith('.pem')
  } catch { return false }
}

async function validSnsEnvelope(envelope: SnsEnvelope) {
  const expectedTopic = process.env.AWS_SES_SNS_TOPIC_ARN || 'arn:aws:sns:us-east-2:322694470585:saturn-partnership-ses-events'
  if (!envelope.Type || !envelope.Message || !envelope.MessageId || !envelope.Timestamp || !envelope.TopicArn || !envelope.Signature || !envelope.SignatureVersion || !envelope.SigningCertURL) return false
  if (envelope.TopicArn !== expectedTopic || !allowedSnsCertificate(envelope.SigningCertURL)) return false
  if (!['1', '2'].includes(envelope.SignatureVersion)) return false
  const certificate = await fetch(envelope.SigningCertURL, { cache: 'force-cache' })
  if (!certificate.ok) return false
  const verifier = createVerify(envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
  verifier.update(snsSigningString(envelope), 'utf8')
  verifier.end()
  return verifier.verify(await certificate.text(), envelope.Signature, 'base64')
}

function firstTag(tags: Record<string, string[]> | undefined, key: string) {
  const value = tags?.[key]?.[0]
  return value || null
}

function normalizeSesEventType(eventType: string) {
  const normalized = eventType.toLowerCase()
  if (normalized === 'send') return 'email_provider_accepted'
  if (normalized === 'delivery') return 'email_delivered'
  if (normalized === 'open') return 'email_opened'
  if (normalized === 'click') return 'email_clicked'
  if (normalized === 'bounce') return 'email_bounced'
  if (normalized === 'complaint') return 'email_complained'
  if (normalized === 'reject') return 'email_rejected'
  if (normalized === 'deliverydelay') return 'email_delivery_delayed'
  if (normalized === 'subscription') return 'email_unsubscribed'
  return `email_${normalized}`
}

function recipients(message: SesMessage) {
  if (message.bounce?.bouncedRecipients?.length) {
    return message.bounce.bouncedRecipients.map(item => item.emailAddress).filter(Boolean) as string[]
  }
  if (message.complaint?.complainedRecipients?.length) {
    return message.complaint.complainedRecipients.map(item => item.emailAddress).filter(Boolean) as string[]
  }
  if (message.delivery?.recipients?.length) return message.delivery.recipients
  return message.mail?.destination || []
}

async function requireSupabaseWrite(
  request: Promise<Response>,
  operation: string,
  options: { ignoreConflict?: boolean } = {},
) {
  const response = await request
  if (response.status === 409 && options.ignoreConflict) return
  if (!response.ok) {
    throw new Error(`${operation} failed with ${response.status}`)
  }
}

async function handleSesEvent(message: SesMessage, raw: unknown) {
  const eventType = normalizeSesEventType(message.eventType || 'unknown')
  const messageId = message.mail?.messageId || null
  const tags = message.mail?.tags || {}
  const contactId = firstTag(tags, 'contact_id')
  const recipientEmail = recipients(message)[0] || null
  const occurredAt = message.open?.timestamp || message.click?.timestamp || message.delivery?.timestamp || message.mail?.timestamp || new Date().toISOString()
  const subject = message.mail?.commonHeaders?.subject || ''

  const { url, headers } = requireSupabaseEnv()

  await requireSupabaseWrite(fetch(`${url}/rest/v1/email_provider_events`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'ses',
      provider_event_id: messageId ? `${messageId}:${eventType}:${occurredAt}` : null,
      provider_message_id: messageId,
      contact_id: contactId,
      event_type: eventType,
      recipient_email: recipientEmail,
      occurred_at: occurredAt,
      payload: raw,
    }),
  }), 'Saving SES provider event', { ignoreConflict: true })

  if (messageId && recipientEmail) {
    await fetch(`${url}/rest/v1/email_events`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        email_id: messageId,
        event_type: eventType,
        recipient: recipientEmail,
        subject,
        metadata: raw,
        user_agent: message.open?.userAgent || message.click?.userAgent || null,
        ip_address: message.open?.ipAddress || message.click?.ipAddress || null,
        link_url: message.click?.link || null,
        created_at: occurredAt,
      }),
    }).catch(() => {})
  }

  if (contactId) {
    const contactUpdates: Record<string, unknown> = { last_touch_at: occurredAt }
    if (eventType === 'email_opened') contactUpdates.email_last_opened_at = occurredAt
    if (eventType === 'email_clicked') contactUpdates.email_last_clicked_at = occurredAt
    if (eventType === 'email_bounced') {
      contactUpdates.email_last_bounced_at = occurredAt
      contactUpdates.email_status = 'bounced'
      contactUpdates.sequence_paused = true
      contactUpdates.sequence_paused_reason = 'email_bounced'
    }
    if (eventType === 'email_complained' || eventType === 'email_unsubscribed') {
      contactUpdates.email_unsubscribed_at = occurredAt
      contactUpdates.email_status = eventType === 'email_complained' ? 'complained' : 'unsubscribed'
      contactUpdates.do_not_contact = true
      contactUpdates.sequence_paused = true
      contactUpdates.sequence_paused_reason = eventType
      contactUpdates.cross_channel_suppressed_at = occurredAt
      contactUpdates.cross_channel_suppression_reason = eventType
    }

    await requireSupabaseWrite(fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(contactUpdates),
    }), 'Updating email contact status')

    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contactId,
        channel: 'email',
        direction: ['email_opened', 'email_clicked'].includes(eventType) ? 'inbound' : 'outbound',
        notes: `SES event: ${eventType}${subject ? ` — "${subject}"` : ''}`,
        outcome_code: eventType,
        created_by: 'SES',
        created_at: occurredAt,
        metadata: { provider: 'ses', provider_message_id: messageId, recipient_email: recipientEmail },
      }),
    }).catch(() => {})
  }

  if (recipientEmail && ['email_bounced', 'email_complained', 'email_unsubscribed'].includes(eventType)) {
    await pausePartnershipSequenceForInbound({
      channel: 'email',
      email: recipientEmail,
      occurredAt,
      notes: `SES ${eventType.replace('email_', '')} event`,
      metadata: { source: 'ses', provider_message_id: messageId },
    }).catch(() => {})
  }
}

export async function POST(request: Request) {
  const rawText = await request.text()
  let payload: SnsEnvelope | SesMessage
  try {
    payload = JSON.parse(rawText) as SnsEnvelope | SesMessage
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const snsEnvelope = 'Type' in payload ? payload as SnsEnvelope : null
  if (!snsEnvelope) return NextResponse.json({ error: 'SNS notification required' }, { status: 401 })

  const headerType = request.headers.get('x-amz-sns-message-type')
  if (headerType !== snsEnvelope.Type || !(await validSnsEnvelope(snsEnvelope))) return NextResponse.json({ error: 'Invalid SNS signature' }, { status: 401 })

  if (snsEnvelope?.Type === 'SubscriptionConfirmation' && typeof snsEnvelope.SubscribeURL === 'string') {
    const response = await fetch(snsEnvelope.SubscribeURL, { cache: 'no-store' })
    return NextResponse.json({ ok: response.ok, type: 'SubscriptionConfirmation' })
  }

  if (snsEnvelope?.Type === 'Notification' && typeof snsEnvelope.Message === 'string') {
    const message = JSON.parse(snsEnvelope.Message) as SesMessage
    await handleSesEvent(message, snsEnvelope)
    return NextResponse.json({ ok: true, type: 'Notification', eventType: message.eventType })
  }

  return NextResponse.json({ error: 'Unsupported SNS message type' }, { status: 400 })
}
