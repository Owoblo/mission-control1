import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getTwilioCredentials, requireSupabaseEnv } from '@/lib/server/runtime'
import { normalizeMarketingPhone, isOptOutText } from '@/lib/server/partnership-sms'
import { recordOutboundSmsToSupabase } from '@/lib/server/sales-messaging'
import { twilioAuth } from '@/lib/server/twilio-recordings'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import {
  DEFAULT_PARTNERSHIP_FROM_NUMBER,
  getPartnershipPrimaryNumberForMarket,
  isPartnershipSenderNumber,
} from '@/lib/partnership-lines'

function normalizePhoneNumber(value: unknown) {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value.trim()
}

function normalizePartnershipPhone(value: unknown) {
  const normalized = normalizePhoneNumber(value)
  return isPartnershipSenderNumber(normalized, { includeRecovery: true }) ? normalized : ''
}

function metadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function threadSenderFromTouches(touches: Array<Record<string, unknown>>) {
  for (const touch of touches) {
    const metadata = touch.metadata && typeof touch.metadata === 'object'
      ? touch.metadata as Record<string, unknown>
      : {}
    const direction = String(touch.direction || '').toLowerCase()
    const candidate = direction === 'inbound'
      ? metadataString(metadata, ['to', 'To', 'to_number', 'toNumber'])
      : metadataString(metadata, ['from', 'From', 'from_number', 'fromNumber'])
    const normalized = normalizePartnershipPhone(candidate)
    if (normalized) return normalized
  }
  return ''
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const payload = await request.json().catch(() => ({})) as {
    body?: string
    from_number?: string
    media_urls?: string[]
  }

  const smsBody = (payload.body || '').trim()
  const mediaUrls = Array.isArray(payload.media_urls)
    ? payload.media_urls.map(url => String(url || '').trim()).filter(Boolean).slice(0, 10)
    : []

  if (!smsBody && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'Message body or media is required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactRes.ok ? await contactRes.json() : []) as Array<Record<string, unknown>>
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const toNumber = normalizeMarketingPhone(contact.phone as string | null)
  if (!toNumber) return NextResponse.json({ error: 'Contact has no usable phone number' }, { status: 400 })

  const stage = String(contact.stage || '').toLowerCase()
  const decision = String(contact.decision || '').toLowerCase()
  if (stage === 'dnc' || stage === 'closed_lost' || decision === 'opted_out' || isOptOutText(contact.notes as string | null)) {
    return NextResponse.json({ error: 'Contact is opted out or closed' }, { status: 400 })
  }

  const touchesRes = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(id)}&channel=eq.sms&select=id,direction,metadata,created_at&order=created_at.desc&limit=25`,
    { headers, cache: 'no-store' }
  )
  const recentTouches = (touchesRes.ok ? await touchesRes.json() : []) as Array<Record<string, unknown>>
  const fromNumber = normalizePartnershipPhone(payload.from_number) ||
    threadSenderFromTouches(recentTouches) ||
    getPartnershipPrimaryNumberForMarket(contact.city as string | null) ||
    DEFAULT_PARTNERSHIP_FROM_NUMBER

  const { accountSid, authToken } = getTwilioCredentials()
  const twilioBody = new URLSearchParams({
    From: fromNumber,
    To: toNumber,
    Body: smsBody || ' ',
  })
  for (const mediaUrl of mediaUrls) twilioBody.append('MediaUrl', mediaUrl)

  const twilioRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuth(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: twilioBody,
    }
  )
  const twilioJson = await twilioRes.json().catch(() => ({})) as Record<string, unknown>
  if (!twilioRes.ok) {
    const message = typeof twilioJson.message === 'string' ? twilioJson.message : 'Twilio send failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const now = new Date().toISOString()
  const sid = typeof twilioJson.sid === 'string' ? twilioJson.sid : null
  const mediaNote = mediaUrls.length ? `\n[MMS: ${mediaUrls.join(', ')}]` : ''
  const touchRes = await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: id,
      channel: 'sms',
      direction: 'outbound',
      notes: `${smsBody}${mediaNote}`.trim(),
      created_by: session.name ?? 'Rep',
      created_at: now,
      next_follow_up_on: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      metadata: {
        from: fromNumber,
        to: toNumber,
        twilioSid: sid,
        ...(mediaUrls.length ? { mediaUrls } : {}),
      },
    }),
  })

  const [touch] = (touchRes.ok ? await touchRes.json() : []) as Array<Record<string, unknown>>

  await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      last_touch_at: now,
      next_follow_up: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      stage: ['target', 'mail_sent', 'follow_up_due'].includes(stage) ? 'attempting_contact' : contact.stage,
    }),
  }).catch(() => {})

  void recordOutboundSmsToSupabase(fromNumber, toNumber, smsBody, undefined, sid)

  return NextResponse.json({ ok: true, sid, touch, fromNumber, toNumber })
}
