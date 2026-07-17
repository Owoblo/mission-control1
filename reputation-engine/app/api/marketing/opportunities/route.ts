import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { partnershipRecordMatchesSession, partnershipScopeFilter } from '@/lib/server/partnership-access'

export const dynamic = 'force-dynamic'

async function loadContact(url: string, headers: Record<string, string>, contactId: string) {
  const res = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,name,city,category,industry,partner_company_id,owner_name,owner_email,assigned_manager_user_id&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [contact] = res.ok ? await res.json() as Array<Record<string, unknown>> : []
  return contact || null
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contactId = searchParams.get('contact_id')
  const companyId = searchParams.get('company_id')
  const stage = searchParams.get('stage')
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)))
  const { url, headers } = requireSupabaseEnv()

  let query = `${url}/rest/v1/partner_opportunities?select=*&order=updated_at.desc&limit=${limit}`
  if (contactId) query += `&contact_id=eq.${encodeURIComponent(contactId)}`
  if (companyId) query += `&company_id=eq.${encodeURIComponent(companyId)}`
  if (stage) query += `&stage=eq.${encodeURIComponent(stage)}`
  query += partnershipScopeFilter(session, ['city'])

  const res = await fetch(query, { headers, cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return NextResponse.json([])
  return NextResponse.json(await res.json())
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    contact_id: string
    name?: string
    stage?: string
    value_potential_cents?: number
    probability?: number
    expected_close_date?: string | null
    next_action?: string | null
    next_action_due?: string | null
    notes?: string | null
  }
  if (!body.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const contact = await loadContact(url, headers, body.contact_id)
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const opportunityName = body.name?.trim() || `${contact.name || 'Partner'} opportunity`
  const res = await fetch(`${url}/rest/v1/partner_opportunities`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      company_id: contact.partner_company_id || null,
      name: opportunityName,
      city: contact.city || null,
      category: contact.category || contact.industry || null,
      stage: body.stage || 'new_opportunity',
      value_potential_cents: body.value_potential_cents ?? null,
      probability: body.probability ?? null,
      expected_close_date: body.expected_close_date || null,
      assigned_manager_user_id: contact.assigned_manager_user_id || session.userId || null,
      assigned_manager_name: contact.owner_name || session.name || null,
      assigned_manager_email: contact.owner_email || null,
      next_action: body.next_action || null,
      next_action_due: body.next_action_due || null,
      notes: body.notes || null,
    }),
  })
  if (!res.ok) return NextResponse.json({ error: 'Could not create opportunity' }, { status: 500 })
  const [opportunity] = await res.json()

  await fetch(`${url}/rest/v1/partner_activity_logs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      company_id: contact.partner_company_id || null,
      opportunity_id: opportunity.id,
      actor_user_id: session.userId || null,
      actor_name: session.name || null,
      action: 'opportunity.created',
      next_value: opportunity,
      metadata: { source: 'marketing_opportunities_api' },
    }),
  }).catch(() => {})

  return NextResponse.json({ ok: true, opportunity })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as Record<string, unknown> & { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { url, headers } = requireSupabaseEnv()
  const currentRes = await fetch(
    `${url}/rest/v1/partner_opportunities?id=eq.${encodeURIComponent(body.id)}&select=*,market_contacts:contact_id(id,city,owner_name,assigned_manager_user_id)&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [current] = currentRes.ok ? await currentRes.json() as Array<Record<string, unknown>> : []
  if (!current) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
  const contact = current.market_contacts as Record<string, unknown> | undefined
  if (!partnershipRecordMatchesSession(session, contact || current)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const allowed = ['name', 'stage', 'value_potential_cents', 'probability', 'expected_close_date', 'next_action', 'next_action_due', 'notes']
  const updates = Object.fromEntries(allowed.filter(key => key in body).map(key => [key, body[key] || null]))
  const res = await fetch(`${url}/rest/v1/partner_opportunities?id=eq.${encodeURIComponent(body.id)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) return NextResponse.json({ error: 'Could not update opportunity' }, { status: 500 })
  const [opportunity] = await res.json()
  return NextResponse.json({ ok: true, opportunity })
}
