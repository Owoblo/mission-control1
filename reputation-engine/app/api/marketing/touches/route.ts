import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'

function normalizePhoneNumber(value: unknown) {
  if (typeof value !== 'string') return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return value.trim()
}

function metadataString(metadata: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!metadata) return ''
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isVisiblePartnershipTouch(touch: Record<string, unknown>) {
  if (String(touch.channel || '').toLowerCase() !== 'sms') return true
  const metadata = touch.metadata && typeof touch.metadata === 'object'
    ? touch.metadata as Record<string, unknown>
    : null
  const direction = String(touch.direction || '').toLowerCase()
  const candidate = direction === 'inbound'
    ? metadataString(metadata, ['to', 'To', 'to_number', 'toNumber'])
    : metadataString(metadata, ['from', 'From', 'from_number', 'fromNumber'])
  const normalized = normalizePhoneNumber(candidate)
  return !!normalized && isPartnershipSenderNumber(normalized)
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contactId = searchParams.get('contact_id')
  if (!contactId) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,city&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactRes.ok ? await contactRes.json() : []) as Array<Record<string, unknown>>
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const res = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  const touches = (await res.json()) as Array<Record<string, unknown>>
  return NextResponse.json(touches.filter(isVisiblePartnershipTouch))
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    contact_id: string
    channel: string
    direction?: string
    notes?: string
    new_stage?: string
    touch_date?: string
    next_follow_up?: string | null
    schedule_follow_up_days?: number
    outcome_code?: string
    next_step?: string
    metadata?: Record<string, unknown>
  }

  if (!body.contact_id || !body.channel) {
    return NextResponse.json({ error: 'contact_id and channel required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const touchDate = body.touch_date || new Date().toISOString()

  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}&select=id,stage,next_follow_up,city`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactRes.ok ? await contactRes.json() : []) as Array<{ id: string; stage: string | null; next_follow_up: string | null }>
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact as unknown as Record<string, unknown>)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Insert touch
  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      channel: body.channel,
      direction: body.direction ?? 'outbound',
      notes: body.notes ?? null,
      created_by: session.name ?? 'Rep',
      created_at: touchDate,
      outcome_code: body.outcome_code ?? null,
      next_step: body.next_step ?? null,
      next_follow_up_on: body.next_follow_up ?? null,
      metadata: body.metadata ?? {},
    }),
  })

  // Update contact's last_touch and optionally stage
  const updates: Record<string, unknown> = { last_touch_at: touchDate }
  const currentStage = normalizePartnershipStage(contact?.stage)

  if (body.new_stage) {
    updates.stage = body.new_stage
  } else if (body.channel === 'direct_mail') {
    updates.stage = 'mail_sent'
  } else if (['phone', 'email', 'linkedin', 'sms'].includes(body.channel) && ['target', 'mail_sent', 'follow_up_due'].includes(currentStage)) {
    updates.stage = 'attempting_contact'
  }

  if (body.next_follow_up !== undefined) {
    updates.next_follow_up = body.next_follow_up || null
  } else if (typeof body.schedule_follow_up_days === 'number') {
    updates.next_follow_up = defaultFollowUpDate(touchDate, body.schedule_follow_up_days)
  } else if (body.channel === 'direct_mail' && !contact?.next_follow_up) {
    updates.next_follow_up = defaultFollowUpDate(touchDate, 21)
  }

  if ((body.direction ?? 'outbound') === 'inbound') {
    updates.last_inbound_at = touchDate
  }

  if (body.outcome_code === 'meeting_booked') {
    updates.stage = body.new_stage || 'qualified'
    updates.meeting_booked_at = touchDate
  } else if (body.outcome_code === 'partnership_secured') {
    updates.stage = body.new_stage || 'partnership_active'
    updates.partnership_outcome = 'secured'
    updates.partnership_outcome_at = touchDate
    updates.partnership_started_at = touchDate
    updates.account_status = 'active'
    updates.next_follow_up = null
  } else if (body.outcome_code === 'not_fit') {
    updates.stage = body.new_stage || 'closed_lost'
    updates.partnership_outcome = 'not_fit'
    updates.partnership_outcome_at = touchDate
    updates.account_status = 'closed'
  } else if (body.outcome_code === 'replied_positive') {
    updates.stage = body.new_stage || 'connected'
  } else if (body.outcome_code === 'replied_negative') {
    updates.stage = body.new_stage || 'closed_lost'
    updates.partnership_outcome = 'declined'
    updates.partnership_outcome_at = touchDate
  }

  await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}`,
    { method: 'PATCH', headers, body: JSON.stringify(updates) }
  )

  return NextResponse.json({ ok: true })
}
