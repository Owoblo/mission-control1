import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import {
  buildRecentSaleEventKey,
  buildRecentSaleMessage,
  classifyRecentSaleRelationship,
  type ListingRepresentative,
  type RecentSaleContact,
  scoreRecentSaleContact,
} from '@/lib/recent-sale-opportunity'
import {
  partnershipRecordMatchesSession,
  partnershipScopeFilter,
} from '@/lib/server/partnership-access'

export const dynamic = 'force-dynamic'

type VerifiedSaleInput = {
  listing_id?: string | null
  mls_id?: string | null
  address: string
  city?: string | null
  region?: string | null
  sold_detected_at?: string | null
  sold_verified_at?: string | null
  verification_source: string
  verification_confidence?: number
  attribution_source?: string | null
  attribution_captured_at?: string | null
  representative: ListingRepresentative
  metadata?: Record<string, unknown>
}

async function loadContacts(url: string, headers: Record<string, string>) {
  const contacts: RecentSaleContact[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(
      `${url}/rest/v1/market_contacts?select=id,name,company,phone,email,city,stage,relationship_temperature,relationship_score,partnership_outcome,last_inbound_at,partner_company_id,do_not_contact,decision&limit=${pageSize}&offset=${offset}`,
      { headers, cache: 'no-store' }
    )
    if (!response.ok) break
    const page = await response.json() as RecentSaleContact[]
    contacts.push(...page)
    if (page.length < pageSize) break
  }
  return contacts
}

function bestContact(input: VerifiedSaleInput, contacts: RecentSaleContact[]) {
  const representative = { ...input.representative, city: input.city }
  return contacts
    .map(contact => ({ contact, ...scoreRecentSaleContact(representative, contact) }))
    .sort((a, b) => b.score - a.score)[0] || null
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const city = searchParams.get('city')
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 200)))
  const { url, headers } = requireSupabaseEnv()
  let query = `${url}/rest/v1/partner_sale_signals?select=*&order=sold_verified_at.desc.nullslast,created_at.desc&limit=${limit}`
  if (status) query += `&status=eq.${encodeURIComponent(status)}`
  if (city) query += `&city=ilike.*${encodeURIComponent(city)}*`
  query += partnershipScopeFilter(session, ['city'])
  const response = await fetch(query, { headers, cache: 'no-store' })
  if (!response.ok) {
    const details = await response.text()
    return NextResponse.json({ error: 'Could not load recent sales', details }, { status: 500 })
  }
  return NextResponse.json(await response.json())
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await request.json() as VerifiedSaleInput | VerifiedSaleInput[]
  const inputs = Array.isArray(payload) ? payload : [payload]
  if (!inputs.length) return NextResponse.json({ error: 'At least one sale is required' }, { status: 400 })
  if (inputs.some(input => !input.address || !input.representative?.name || !input.verification_source)) {
    return NextResponse.json(
      { error: 'Each sale requires address, representative.name, and verification_source' },
      { status: 400 }
    )
  }

  const { url, headers } = requireSupabaseEnv()
  const contacts = await loadContacts(url, headers)
  const now = new Date().toISOString()
  const records = inputs.map(input => {
    const candidate = bestContact(input, contacts)
    // Name alone is useful for review, but name+brokerage (90) or an exact
    // phone/email (100+) is required before linking automatically.
    const matched = candidate && candidate.score >= 80 ? candidate : null
    const relationship = classifyRecentSaleRelationship(matched?.contact)
    const contact = matched?.contact as (RecentSaleContact & { partner_company_id?: string }) | undefined
    return {
      event_key: buildRecentSaleEventKey({
        mls: input.mls_id,
        address: input.address,
        city: input.city,
        realtorName: input.representative.name,
      }),
      listing_id: input.listing_id || null,
      mls_id: input.mls_id || null,
      address: input.address,
      city: input.city || null,
      region: input.region || null,
      sold_detected_at: input.sold_detected_at || null,
      sold_verified_at: input.sold_verified_at || now,
      verification_status: 'verified',
      verification_source: input.verification_source,
      verification_confidence: Math.max(0, Math.min(100, input.verification_confidence ?? 100)),
      realtor_name: input.representative.name,
      realtor_role: input.representative.role || 'listing_agent',
      realtor_phone: input.representative.phone || null,
      realtor_email: input.representative.email || null,
      realtor_brokerage: input.representative.brokerage || null,
      attribution_source: input.attribution_source || null,
      attribution_captured_at: input.attribution_captured_at || null,
      contact_id: matched?.contact.id || null,
      company_id: contact?.partner_company_id || null,
      match_score: candidate?.score || 0,
      match_reasons: candidate?.reasons || [],
      relationship_tier: relationship,
      suggested_message: buildRecentSaleMessage({
        realtorName: input.representative.name,
        address: input.address,
        city: input.city,
        relationship,
      }),
      status: matched ? 'needs_review' : 'needs_match',
      metadata: input.metadata || {},
    }
  })

  const response = await fetch(`${url}/rest/v1/partner_sale_signals?on_conflict=event_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(records),
  })
  if (!response.ok) {
    const details = await response.text()
    return NextResponse.json({ error: 'Could not ingest verified sales', details }, { status: 500 })
  }
  return NextResponse.json({ ok: true, sales: await response.json() })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json() as {
    id?: string
    status?: string
    contact_id?: string | null
    suggested_message?: string
    dismissal_reason?: string | null
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const currentResponse = await fetch(
    `${url}/rest/v1/partner_sale_signals?id=eq.${encodeURIComponent(body.id)}&select=*&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [current] = currentResponse.ok ? await currentResponse.json() as Array<Record<string, unknown>> : []
  if (!current) return NextResponse.json({ error: 'Recent sale not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, current)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  if (body.suggested_message !== undefined) updates.suggested_message = body.suggested_message.trim()
  if (body.status) {
    updates.status = body.status
    if (body.status === 'ready') {
      updates.reviewed_by = session.name || 'Rep'
      updates.reviewed_at = new Date().toISOString()
    }
    if (body.status === 'sent') updates.sent_at = new Date().toISOString()
    if (body.status === 'dismissed') {
      updates.dismissed_at = new Date().toISOString()
      updates.dismissal_reason = body.dismissal_reason || 'Dismissed by reviewer'
    }
  }
  if (body.contact_id !== undefined) {
    updates.contact_id = body.contact_id
    if (body.contact_id) {
      const contactResponse = await fetch(
        `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}&select=id,name,company,phone,email,city,stage,relationship_temperature,relationship_score,partnership_outcome,last_inbound_at,partner_company_id&limit=1`,
        { headers, cache: 'no-store' }
      )
      const [contact] = contactResponse.ok ? await contactResponse.json() as Array<RecentSaleContact & { partner_company_id?: string }> : []
      if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      const relationship = classifyRecentSaleRelationship(contact)
      updates.company_id = contact.partner_company_id || null
      updates.relationship_tier = relationship
      updates.status = 'needs_review'
      updates.suggested_message = buildRecentSaleMessage({
        realtorName: String(current.realtor_name || contact.name || ''),
        address: String(current.address || ''),
        city: String(current.city || ''),
        relationship,
      })
    }
  }

  const response = await fetch(`${url}/rest/v1/partner_sale_signals?id=eq.${encodeURIComponent(body.id)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  })
  if (!response.ok) return NextResponse.json({ error: 'Could not update recent sale' }, { status: 500 })
  const [sale] = await response.json()
  return NextResponse.json({ ok: true, sale })
}
