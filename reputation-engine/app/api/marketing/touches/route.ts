import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contactId = searchParams.get('contact_id')
  if (!contactId) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json(await res.json())
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
  }

  if (!body.contact_id || !body.channel) {
    return NextResponse.json({ error: 'contact_id and channel required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const touchDate = body.touch_date || new Date().toISOString()

  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}&select=id,stage,next_follow_up`,
    { headers, cache: 'no-store' }
  )
  const [contact] = (contactRes.ok ? await contactRes.json() : []) as Array<{ id: string; stage: string | null; next_follow_up: string | null }>

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

  await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}`,
    { method: 'PATCH', headers, body: JSON.stringify(updates) }
  )

  return NextResponse.json({ ok: true })
}
