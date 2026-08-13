import { NextResponse } from 'next/server'
import { CATEGORY_LIST } from '@/lib/partner-categories'
import { normalizePartnerDirectoryQuery } from '@/lib/partner-directory'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const searchParams = new URL(request.url).searchParams
  const query = normalizePartnerDirectoryQuery(searchParams.get('q') || '')
  if (query.length < 2) return NextResponse.json({ contacts: [] })

  const { url, headers } = requireSupabaseEnv()
  const term = encodeURIComponent(query)
  if (searchParams.get('type') === 'companies') {
    const companyResponse = await fetch(`${url}/rest/v1/partner_companies?select=id,company_name,city,industry&company_name=ilike.*${term}*&order=company_name.asc&limit=20`, { headers, cache: 'no-store' })
    if (!companyResponse.ok) return NextResponse.json({ error: 'Could not search brokerages' }, { status: 502 })
    const companies = (await companyResponse.json() as Array<Record<string, unknown>>).map(row => ({ id: row.id, name: row.company_name, city: row.city, industry: row.industry }))
    return NextResponse.json({ companies })
  }
  const response = await fetch(
    `${url}/rest/v1/market_contacts?select=id,name,company,title,email,phone,city,category,industry,stage&or=(name.ilike.*${term}*,company.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${term}*,city.ilike.*${term}*)&order=name.asc&limit=20`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return NextResponse.json({ error: 'Could not search partnership directory' }, { status: 502 })
  return NextResponse.json({ contacts: await response.json() })
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json() as Record<string, unknown>
  const name = text(body.name)
  if (!name) return NextResponse.json({ error: 'Partner name is required' }, { status: 400 })
  const category = text(body.category)
  if (category && !CATEGORY_LIST.some(item => item.id === category)) {
    return NextResponse.json({ error: 'Invalid partnership category' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const email = text(body.email).toLowerCase()
  const phone = text(body.phone)
  const duplicateTerms = [
    email ? `email.eq.${encodeURIComponent(email)}` : '',
    phone ? `phone.eq.${encodeURIComponent(phone)}` : '',
  ].filter(Boolean).join(',')
  const company = text(body.company)
  const partnerCompanyId = text(body.partnerCompanyId)
  const duplicateFilter = duplicateTerms
    ? `or=(${duplicateTerms})`
    : `name=ilike.${encodeURIComponent(name)}${company ? `&company=ilike.${encodeURIComponent(company)}` : ''}`
  const duplicateResponse = await fetch(
    `${url}/rest/v1/market_contacts?select=id,name,company,title,email,phone,city,category,industry,stage&${duplicateFilter}&limit=5`,
    { headers, cache: 'no-store' }
  )
  const duplicateRows = duplicateResponse.ok ? await duplicateResponse.json() as Array<Record<string, unknown>> : []
  if (duplicateRows[0]) return NextResponse.json({ contact: duplicateRows[0], existing: true })

  const row = {
    name,
    company: company || null,
    partner_company_id: partnerCompanyId || null,
    title: text(body.title) || null,
    email: email || null,
    phone: phone || null,
    city: text(body.city) || null,
    category: category || null,
    industry: text(body.industry) || (category === 'realtor' ? 'Real Estate' : null),
    stage: 'referring',
    pipeline_phase: 'relationship',
    sequence_step: 0,
    sequence_paused: true,
    sequence_paused_reason: 'created_from_sales_referral',
    referred_lead_count: 0,
    notes: `Created from Sales CRM referral attribution by ${session?.name || 'staff'}.`,
    created_at: new Date().toISOString(),
  }
  const response = await fetch(`${url}/rest/v1/market_contacts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  })
  if (!response.ok) {
    const detail = await response.text()
    return NextResponse.json({ error: `Could not create partnership record: ${detail}` }, { status: 502 })
  }
  const [contact] = await response.json()
  return NextResponse.json({ contact, existing: false })
}
