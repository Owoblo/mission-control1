import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { encodeSenderTemplateKey, isOptOutText } from '@/lib/server/partnership-sms'
import {
  DEFAULT_PARTNERSHIP_FROM_NUMBER,
  getPartnershipPrimaryNumberForMarket,
  isPartnershipSenderNumber,
} from '@/lib/partnership-lines'
const MIN_SCHEDULE_DELAY_MS = 1000 * 60

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
    const scheduled = metadata.scheduled_reply && typeof metadata.scheduled_reply === 'object'
      ? metadata.scheduled_reply as Record<string, unknown>
      : {}
    const direction = String(touch.direction || '').toLowerCase()
    const candidate = direction === 'inbound'
      ? metadataString(metadata, ['to', 'To', 'to_number', 'toNumber'])
      : metadataString(metadata, ['from', 'From', 'from_number', 'fromNumber']) ||
        metadataString(scheduled, ['fromNumber', 'from_number', 'from'])
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
  const body = await request.json().catch(() => ({})) as {
    body?: string
    scheduled_at?: string
    from_number?: string
    media_urls?: string[]
  }

  const smsBody = (body.body || '').trim()
  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null
  const mediaUrls = Array.isArray(body.media_urls)
    ? body.media_urls.map(url => String(url || '').trim()).filter(Boolean).slice(0, 10)
    : []

  if (!smsBody && mediaUrls.length === 0) {
    return NextResponse.json({ error: 'Message body or media is required' }, { status: 400 })
  }

  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'Valid scheduled_at is required' }, { status: 400 })
  }

  if (scheduledAt.getTime() < Date.now() + MIN_SCHEDULE_DELAY_MS) {
    return NextResponse.json({ error: 'Schedule at least 1 minute in the future' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactRes.ok ? await contactRes.json() : []) as Array<Record<string, unknown>>
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!contact.phone) return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 })

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

  const now = new Date().toISOString()
  const fromNumber = normalizePartnershipPhone(body.from_number) ||
    threadSenderFromTouches(recentTouches) ||
    getPartnershipPrimaryNumberForMarket(contact.city as string | null) ||
    DEFAULT_PARTNERSHIP_FROM_NUMBER
  const scheduledIso = scheduledAt.toISOString()
  const mediaNote = mediaUrls.length ? `\n[MMS: ${mediaUrls.join(', ')}]` : ''

  const touchRes = await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: id,
      channel: 'sms',
      direction: 'system',
      notes: `Scheduled SMS for ${scheduledIso}:\n${smsBody}${mediaNote}`.trim(),
      outcome_code: 'scheduled_reply_pending',
      next_step: `SMS scheduled for ${scheduledIso}`,
      next_follow_up_on: scheduledIso.slice(0, 10),
      metadata: {
        scheduled_reply: {
          status: 'pending',
          body: smsBody,
          mediaUrls,
          fromNumber,
          scheduled_at: scheduledIso,
        },
      },
      created_by: session.name ?? 'Rep',
      created_at: now,
    }),
  })

  if (!touchRes.ok) return NextResponse.json({ error: 'Could not create scheduled touch' }, { status: 500 })
  const [touch] = await touchRes.json() as Array<{ id: string }>

  const jobRes = await fetch(`${url}/rest/v1/sequence_jobs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: id,
      batch_id: contact.batch_id ?? null,
      channel: 'sms',
      scheduled_at: scheduledIso,
      status: 'pending',
      template_key: `scheduled_reply:${touch.id}:${encodeSenderTemplateKey(fromNumber)}`,
    }),
  })

  if (!jobRes.ok) {
    await fetch(`${url}/rest/v1/market_touches?id=eq.${touch.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        outcome_code: 'scheduled_reply_failed',
        next_step: 'Could not queue scheduled SMS',
      }),
    }).catch(() => {})
    return NextResponse.json({ error: 'Could not queue scheduled SMS' }, { status: 500 })
  }

  const [job] = await jobRes.json() as Array<Record<string, unknown>>
  await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      last_touch_at: now,
      next_follow_up: scheduledIso.slice(0, 10),
    }),
  }).catch(() => {})

  return NextResponse.json({ ok: true, touch, job, scheduled_at: scheduledIso })
}
