import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { defaultFollowUpDate, getPipelineBucket, isDateDue, normalizePartnershipStage } from '@/lib/marketing'
import { activateAffiliatePartner } from '@/lib/server/affiliate-bridge'
import { partnershipRecordMatchesSession, partnershipScopeFilter, partnershipScopeOrClause } from '@/lib/server/partnership-access'

interface MarketContact {
  id: string
  name: string
  company: string
  title: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  industry: string | null
  tier: string | null
  tracking_code: string | null
  stage: string | null
  notes: string | null
  last_touch_at: string | null
  next_follow_up: string | null
  owner_name?: string | null
  owner_email?: string | null
  priority?: string | null
  account_status?: string | null
  mailed_at?: string | null
  mailed_by?: string | null
  meeting_booked_at?: string | null
  partnership_outcome?: string | null
  partnership_outcome_at?: string | null
  partnership_started_at?: string | null
  last_inbound_at?: string | null
  referred_lead_count?: number | null
  created_at: string
}

interface MarketTouch {
  id: string
  contact_id: string
  channel: string
  direction: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

interface QueueItem {
  id: string
  contact_id: string
  channel: string
  due_date: string
  label: string
  status: string
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stage = searchParams.get('stage')
  const tier = searchParams.get('tier')
  const industry = searchParams.get('industry')
  const q = searchParams.get('q')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  const { url, headers } = requireSupabaseEnv()

  let query = `${url}/rest/v1/market_contacts?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (stage) query += `&stage=eq.${encodeURIComponent(stage)}`
  if (tier) query += `&tier=eq.${encodeURIComponent(tier)}`
  if (industry) query += `&industry=eq.${encodeURIComponent(industry)}`
  const scopeClause = partnershipScopeOrClause(session)
  const searchClause = q
    ? `name.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*,city.ilike.*${encodeURIComponent(q)}*`
    : ''
  if (scopeClause && searchClause) {
    query += `&and=(or(${scopeClause}),or(${searchClause}))`
  } else {
    if (scopeClause) query += partnershipScopeFilter(session)
    if (searchClause) query += `&or=(${searchClause})`
  }

  const res = await fetch(query, { headers: { ...headers, Prefer: 'count=exact' }, cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })

  const contacts = await res.json() as MarketContact[]
  const total = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0')

  if (contacts.length === 0) {
    return NextResponse.json({ contacts: [], total })
  }

  const contactIds = contacts.map(contact => `"${contact.id}"`).join(',')
  const [touchRes, queueRes] = await Promise.all([
    fetch(
      `${url}/rest/v1/market_touches?select=id,contact_id,channel,direction,notes,created_by,created_at,metadata&contact_id=in.(${contactIds})&order=created_at.desc`,
      { headers, cache: 'no-store' }
    ),
    fetch(
      `${url}/rest/v1/market_queue?select=id,contact_id,channel,due_date,label,status&contact_id=in.(${contactIds})&status=eq.pending&order=due_date.asc`,
      { headers, cache: 'no-store' }
    ),
  ])

  const touches = (touchRes.ok ? await touchRes.json() : []) as MarketTouch[]
  const queueItems = (queueRes.ok ? await queueRes.json() : []) as QueueItem[]

  const touchMap = new Map<string, MarketTouch[]>()
  for (const touch of touches) {
    const list = touchMap.get(touch.contact_id) ?? []
    list.push(touch)
    touchMap.set(touch.contact_id, list)
  }

  const queueMap = new Map<string, QueueItem[]>()
  for (const item of queueItems) {
    const list = queueMap.get(item.contact_id) ?? []
    list.push(item)
    queueMap.set(item.contact_id, list)
  }

  const today = new Date()
  const enriched = contacts.map(contact => {
    const contactTouches = [...(touchMap.get(contact.id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
    const pending = queueMap.get(contact.id) ?? []
    const latestTouch = contactTouches[0] ?? null
    const latestInboundTouch = contactTouches.find(touch => touch.direction === 'inbound') ?? null
    const lastDirectMail = contactTouches.find(touch => touch.channel === 'direct_mail')
    const lastCall = contactTouches.find(touch => touch.channel === 'phone')
    const lastEmail = contactTouches.find(touch => touch.channel === 'email')
    const nextQueue = pending[0] ?? null
    const normalizedStage = normalizePartnershipStage(contact.stage)
    const hasReply = contactTouches.some(touch => /replied|responded|connected|booked|secured|meeting/i.test(touch.notes ?? ''))
    const needsFollowUp = isDateDue(contact.next_follow_up, today) || isDateDue(nextQueue?.due_date, today)

    return {
      ...contact,
      normalized_stage: normalizedStage,
      pipeline: getPipelineBucket(contact.tier, contact.industry),
      touch_count: contactTouches.length,
      pending_queue_count: pending.length,
      next_queue_due: nextQueue?.due_date ?? null,
      next_queue_label: nextQueue?.label ?? null,
      last_direct_mail_at: lastDirectMail?.created_at ?? null,
      last_call_at: lastCall?.created_at ?? null,
      last_email_at: lastEmail?.created_at ?? null,
      latest_touch_channel: latestTouch?.channel ?? null,
      latest_touch_direction: latestTouch?.direction ?? null,
      latest_touch_note: latestTouch?.notes ?? null,
      latest_touch_metadata: latestTouch?.metadata ?? null,
      latest_inbound_at: latestInboundTouch?.created_at ?? null,
      latest_inbound_note: latestInboundTouch?.notes ?? null,
      latest_inbound_metadata: latestInboundTouch?.metadata ?? null,
      needs_follow_up: needsFollowUp,
      has_reply: hasReply,
    }
  })

  return NextResponse.json({ contacts: enriched, total })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    id: string
    stage?: string
    notes?: string
    next_follow_up?: string
    name?: string
    company?: string | null
    title?: string | null
    email?: string
    phone?: string | null
    address?: string | null
    city?: string | null
    industry?: string | null
    owner_name?: string | null
    owner_email?: string | null
    priority?: string | null
    account_status?: string | null
    mailed_at?: string | null
    meeting_booked_at?: string | null
    partnership_outcome?: string | null
    referred_lead_count?: number | null
    sequence_paused?: boolean
    sequence_paused_reason?: string | null
    decision?: string | null
    quick_action?: 'mark_mail_sent' | 'mark_follow_up_due' | 'mark_partnership_active' | 'snooze_21_days'
    touch_note?: string
    touch_channel?: string
    touch_date?: string
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.stage) updates.stage = body.stage
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.next_follow_up !== undefined) updates.next_follow_up = body.next_follow_up || null
  if (body.name !== undefined) updates.name = body.name
  if (body.company !== undefined) updates.company = body.company || null
  if (body.title !== undefined) updates.title = body.title || null
  if (body.email !== undefined) updates.email = body.email
  if (body.phone !== undefined) updates.phone = body.phone || null
  if (body.address !== undefined) updates.address = body.address || null
  if (body.city !== undefined) updates.city = body.city || null
  if (body.industry !== undefined) updates.industry = body.industry || null
  if (body.owner_name !== undefined) updates.owner_name = body.owner_name || null
  if (body.owner_email !== undefined) updates.owner_email = body.owner_email || null
  if (body.priority !== undefined) updates.priority = body.priority || 'normal'
  if (body.account_status !== undefined) updates.account_status = body.account_status || 'active'
  if (body.mailed_at !== undefined) updates.mailed_at = body.mailed_at || null
  if (body.meeting_booked_at !== undefined) updates.meeting_booked_at = body.meeting_booked_at || null
  if (body.partnership_outcome !== undefined) {
    updates.partnership_outcome = body.partnership_outcome || null
    updates.partnership_outcome_at = body.partnership_outcome ? new Date().toISOString() : null
  }
  if (body.referred_lead_count !== undefined) updates.referred_lead_count = Math.max(0, body.referred_lead_count ?? 0)
  if (body.sequence_paused !== undefined) updates.sequence_paused = body.sequence_paused
  if (body.sequence_paused_reason !== undefined) updates.sequence_paused_reason = body.sequence_paused_reason || null
  if (body.decision !== undefined) updates.decision = body.decision || null
  if (body.stage) updates.last_touch_at = new Date().toISOString()

  const { url, headers } = requireSupabaseEnv()

  const currentRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.id)}&select=id,city&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [currentContact] = (currentRes.ok ? await currentRes.json() : []) as Array<Record<string, unknown>>
  if (!currentContact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, currentContact)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const touchDate = body.touch_date || new Date().toISOString()
  if (body.quick_action === 'mark_mail_sent') {
    updates.stage = 'mail_sent'
    updates.next_follow_up = body.next_follow_up || defaultFollowUpDate(touchDate, 21)
    updates.last_touch_at = touchDate
    updates.mailed_at = touchDate
    updates.mailed_by = session.name ?? 'Rep'
    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: body.id,
        channel: body.touch_channel || 'direct_mail',
        direction: 'outbound',
        notes: body.touch_note || 'Direct mail sent',
        created_by: session.name ?? 'Rep',
        created_at: touchDate,
      }),
    })
  }

  if (body.quick_action === 'mark_follow_up_due') {
    updates.stage = 'follow_up_due'
    updates.next_follow_up = body.next_follow_up || new Date().toISOString().slice(0, 10)
  }

  if (body.quick_action === 'mark_partnership_active') {
    updates.stage = 'partnership_active'
    updates.next_follow_up = null
    updates.partnership_outcome = 'secured'
    updates.partnership_outcome_at = new Date().toISOString()
    updates.partnership_started_at = new Date().toISOString()
  }

  if (body.quick_action === 'snooze_21_days') {
    updates.next_follow_up = defaultFollowUpDate(new Date(), 21)
    if (!updates.stage) updates.stage = 'dormant'
  }

  const res = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.id)}`,
    { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(updates) }
  )

  if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  const [updated] = await res.json()

  // Bridge: if this update activated a partnership, create their affiliate account
  const isActivated = body.quick_action === 'mark_partnership_active' ||
    body.stage === 'partnership_active'
  if (isActivated) {
    void activateAffiliatePartner(body.id).catch(() => {})
  }

  return NextResponse.json({ ok: true, contact: updated })
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const body = await request.json().catch(() => ({})) as { id?: string }
  const id = body.id || searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const encodedId = encodeURIComponent(id)

  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodedId}&select=id,name,city&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!contactRes.ok) return NextResponse.json({ error: 'Could not load contact' }, { status: 500 })
  const [contact] = await contactRes.json() as Array<{ id: string; name: string | null }>
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cleanupTables = [
    'sequence_jobs',
    'market_queue',
    'market_appointments',
    'market_list_contacts',
    'market_touches',
  ]

  for (const table of cleanupTables) {
    const res = await fetch(`${url}/rest/v1/${table}?contact_id=eq.${encodedId}`, {
      method: 'DELETE',
      headers,
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Could not delete related ${table}` }, { status: 500 })
    }
  }

  const deleteRes = await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodedId}`, {
    method: 'DELETE',
    headers,
  })
  if (!deleteRes.ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })

  return NextResponse.json({ ok: true, deleted_id: id, name: contact.name })
}
