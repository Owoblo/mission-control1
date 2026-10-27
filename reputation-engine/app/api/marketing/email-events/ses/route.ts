import { NextResponse } from 'next/server'
import { recordSesReceipts } from '@/lib/server/email-receipts'
import { emailHash } from '@/lib/server/email-delivery'
import { verifySesInboundSns } from '@/lib/server/ses-inbound-signature'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { sendPartnershipEmailAlert } from '@/lib/server/partnership-email-alerts'

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

async function validSnsEnvelope(envelope: SnsEnvelope) {
  const topic = process.env.AWS_SES_SNS_TOPIC_ARN || 'arn:aws:sns:us-east-2:322694470585:saturn-partnership-ses-events'
  try { return await verifySesInboundSns(envelope as Record<string, string>, topic) }
  catch { return false }
}

function firstTag(tags: Record<string, string[]> | undefined, key: string) {
  const value = tags?.[key]?.[0]
  return value || null
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

async function handleSesEvent(message: SesMessage, raw: unknown, recipientEmail: string, receiptKey: string, receiptAt: string, eventType: string) {
  const messageId = message.mail?.messageId || null
  const tags = message.mail?.tags || {}
  let contactId = firstTag(tags, 'contact_id')
  const occurredAt = receiptAt
  const subject = message.mail?.commonHeaders?.subject || ''

  const { url, headers } = requireSupabaseEnv()
  if(contactId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(contactId))contactId=null
  if (contactId) {
    const lookup=await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,email&limit=1`,{headers,cache:'no-store'})
    if(!lookup.ok) throw new Error('Recipient contact lookup failed')
    const [candidate]=await lookup.json()
    if(!candidate?.email || candidate.email.trim().toLowerCase()!==recipientEmail) contactId=null
  }

  await requireSupabaseWrite(fetch(`${url}/rest/v1/email_provider_events`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      provider: 'ses',
      provider_event_id: messageId ? `${messageId}:${eventType}:${occurredAt}:${recipientEmail}` : null,
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
    const contactUpdates: Record<string, unknown> = {} // Provider telemetry is not a new conversation touch.
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

    if (Object.keys(contactUpdates).length) await requireSupabaseWrite(fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(contactUpdates),
    }), 'Updating email contact status')

    const touchHash=emailHash(receiptKey)
    const touchId=`${touchHash.slice(0,8)}-${touchHash.slice(8,12)}-4${touchHash.slice(13,16)}-a${touchHash.slice(17,20)}-${touchHash.slice(20,32)}`
    await fetch(`${url}/rest/v1/market_touches?on_conflict=id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        id:touchId,contact_id: contactId,
        channel: 'email',
        direction: 'system',
        notes: `SES event: ${eventType}${subject ? ` — "${subject}"` : ''}`,
        outcome_code: eventType,
        created_by: 'SES',
        created_at: occurredAt,
        metadata: { provider: 'ses', provider_message_id: messageId, recipient_email: recipientEmail },
      }),
    }).catch(() => {})
  }

  if (contactId && ['email_bounced', 'email_complained', 'email_unsubscribed'].includes(eventType)) {
    await requireSupabaseWrite(fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${encodeURIComponent(contactId)}&status=eq.pending`, {
      method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled', error: `Paused after ${eventType}` }),
    }), 'Cancelling sequence after provider failure')
    const response = await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,name,company,city,email&limit=1`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Failed to load delivery alert contact')
    const [contact] = await response.json() as Array<{ id: string; name: string; company: string; city: string; email: string }>
    if (contact) await sendPartnershipEmailAlert({
      id: `${messageId}-${eventType}`, contactId, contactName: contact.name, company: contact.company,
      city: contact.city, email: recipientEmail, occurredAt, subject,
      label: eventType === 'email_bounced' ? 'Partner email delivery failure' : eventType === 'email_complained' ? 'Partner email complaint' : 'Partner email opt-out',
      notes: `SES ${eventType.replace('email_', '')} event. ${eventType === 'email_bounced' ? 'This address is paused. Review the delivery diagnostic and research a replacement.' : 'Outreach is stopped for this contact.'}`,
    })
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
    const subscribeUrl = new URL(snsEnvelope.SubscribeURL)
    const region = snsEnvelope.TopicArn?.split(':')[3]
    if (subscribeUrl.origin !== `https://sns.${region}.amazonaws.com` || subscribeUrl.username || subscribeUrl.password || subscribeUrl.searchParams.get('Action') !== 'ConfirmSubscription') return NextResponse.json({ error: 'Invalid subscription URL' }, { status: 400 })
    const response = await fetch(subscribeUrl, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
    return NextResponse.json({ ok: response.ok, type: 'SubscriptionConfirmation' })
  }

  if (snsEnvelope?.Type === 'Notification' && typeof snsEnvelope.Message === 'string') {
    const message = JSON.parse(snsEnvelope.Message) as SesMessage
    const events=await recordSesReceipts(message)
    for(const event of events) await handleSesEvent(message,snsEnvelope,event.recipient,event.eventKey,event.occurredAt,event.eventType)
    return NextResponse.json({ ok: true, type: 'Notification', eventType: message.eventType })
  }

  return NextResponse.json({ error: 'Unsupported SNS message type' }, { status: 400 })
}
