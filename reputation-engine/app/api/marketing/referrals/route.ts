import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { partnershipRecordMatchesSession, partnershipScopeFilter } from '@/lib/server/partnership-access'

export const dynamic = 'force-dynamic'

async function loadContact(url: string, headers: Record<string, string>, contactId: string) {
  const res = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contactId)}&select=id,name,city,partner_company_id,affiliate_partner_id,tracking_code,linked_partner_id,referred_lead_count,owner_name,assigned_manager_user_id&limit=1`,
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
  const leadId = searchParams.get('crm_lead_id')
  const limit = Math.max(1, Math.min(1000, Number(searchParams.get('limit') || 200)))
  const { url, headers } = requireSupabaseEnv()

  let query = `${url}/rest/v1/partner_referrals?select=*&order=created_at.desc&limit=${limit}`
  if (contactId) query += `&contact_id=eq.${encodeURIComponent(contactId)}`
  if (companyId) query += `&company_id=eq.${encodeURIComponent(companyId)}`
  if (leadId) query += `&crm_lead_id=eq.${encodeURIComponent(leadId)}`

  const res = await fetch(query, { headers, cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return NextResponse.json([])
  const rows = await res.json() as Array<Record<string, unknown>>
  if (!session || session.role === 'owner' || session.role === 'manager') return NextResponse.json(rows)

  const contactIds = Array.from(new Set(rows.map(row => row.contact_id).filter(Boolean))) as string[]
  if (contactIds.length === 0) return NextResponse.json([])
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${contactIds.map(id => `"${id}"`).join(',')})&select=id,city,owner_name,assigned_manager_user_id${partnershipScopeFilter(session, ['city'], true)}`,
    { headers, cache: 'no-store' }
  )
  const visible = new Set((contactsRes.ok ? await contactsRes.json() : []).map((contact: { id: string }) => contact.id))
  return NextResponse.json(rows.filter(row => visible.has(String(row.contact_id || ''))))
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    contact_id: string
    customer_name?: string | null
    customer_phone?: string | null
    customer_email?: string | null
    job_city?: string | null
    move_date?: string | null
    crm_lead_id?: string | null
    job_id?: string | null
    quoted_amount_cents?: number | null
    booked_amount_cents?: number | null
    job_status?: string | null
    proof_notes?: string | null
  }
  if (!body.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const contact = await loadContact(url, headers, body.contact_id)
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const res = await fetch(`${url}/rest/v1/partner_referrals`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      company_id: contact.partner_company_id || null,
      affiliate_partner_id: contact.affiliate_partner_id || contact.linked_partner_id || null,
      partner_code: contact.tracking_code || contact.affiliate_partner_id || contact.linked_partner_id || null,
      customer_name: body.customer_name || null,
      customer_phone: body.customer_phone || null,
      customer_email: body.customer_email || null,
      job_city: body.job_city || contact.city || null,
      move_date: body.move_date || null,
      crm_lead_id: body.crm_lead_id || null,
      job_id: body.job_id || null,
      quoted_amount_cents: body.quoted_amount_cents ?? null,
      booked_amount_cents: body.booked_amount_cents ?? null,
      job_status: body.job_status || 'new',
      commission_status: 'rule_required',
      source: 'crm_manual',
      proof_notes: body.proof_notes || null,
    }),
  })
  if (!res.ok) return NextResponse.json({ error: 'Could not create referral' }, { status: 500 })
  const [referral] = await res.json()

  await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ referred_lead_count: Number(contact.referred_lead_count || 0) + 1 }),
  }).catch(() => {})
  await fetch(`${url}/rest/v1/partner_activity_logs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      company_id: contact.partner_company_id || null,
      referral_id: referral.id,
      actor_user_id: session.userId || null,
      actor_name: session.name || null,
      action: 'referral.created',
      next_value: referral,
      metadata: { source: 'marketing_referrals_api' },
    }),
  }).catch(() => {})

  return NextResponse.json({ ok: true, referral })
}
