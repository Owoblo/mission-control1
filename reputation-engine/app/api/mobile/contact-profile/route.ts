import { NextResponse } from 'next/server'
import { normalizePhone } from '@/lib/sales-phones'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLeadByContact } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace') === 'partnership' ? 'partnership' : 'sales'

  if (workspace === 'sales') {
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const lead = await getSalesLeadByContact(
      normalizePhone(searchParams.get('phone')),
      null,
      null,
      { includeClosed: true },
    )
    return NextResponse.json({
      profile: lead ? {
        id: lead.id,
        workspace,
        name: lead.name,
        phone: lead.phone || '',
        email: lead.email || '',
        company: '',
        title: lead.moveType ? `${lead.moveType.replace(/_/g, ' ')} move` : 'Sales customer',
        city: lead.originCity || lead.destCity || '',
        area: lead.branch || '',
        status: lead.stage,
        notes: lead.notes || lead.opportunityContext?.summary || '',
        details: [
          lead.moveDate ? `Move date · ${lead.moveDate}` : '',
          [lead.originCity, lead.destCity].filter(Boolean).join(' → '),
          lead.assignedRepName ? `Assigned · ${lead.assignedRepName}` : '',
        ].filter(Boolean),
      } : null,
    })
  }

  const id = searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'Contact is required' }, { status: 400 })
  const { url, headers } = requireSupabaseEnv()
  const contactResponse = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=id,name,company,title,email,phone,address,city,industry,stage,notes,partner_company_id,owner_name&limit=1`,
    { headers, cache: 'no-store' },
  )
  const [contact] = contactResponse.ok
    ? await contactResponse.json() as Array<Record<string, unknown>>
    : []
  if (!contact) return NextResponse.json({ profile: null })
  if (!partnershipRecordMatchesSession(session, contact)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let linkedCompany: Record<string, unknown> | null = null
  if (contact.partner_company_id) {
    const companyResponse = await fetch(
      `${url}/rest/v1/partner_companies?id=eq.${encodeURIComponent(String(contact.partner_company_id))}&select=company_name,industry,website,main_phone,city,account_status,partnership_potential,total_referrals&limit=1`,
      { headers, cache: 'no-store' },
    )
    linkedCompany = companyResponse.ok
      ? (await companyResponse.json() as Array<Record<string, unknown>>)[0] || null
      : null
  }

  return NextResponse.json({
    profile: {
      id: contact.id,
      workspace,
      name: contact.name || 'Partnership contact',
      phone: contact.phone || '',
      email: contact.email || '',
      company: linkedCompany?.company_name || contact.company || '',
      title: contact.title || contact.industry || 'Partnership contact',
      city: linkedCompany?.city || contact.city || '',
      area: contact.city || '',
      status: linkedCompany?.account_status || contact.stage || '',
      notes: contact.notes || '',
      details: [
        contact.address ? String(contact.address) : '',
        linkedCompany?.website ? String(linkedCompany.website) : '',
        linkedCompany?.partnership_potential
          ? `Potential · ${linkedCompany.partnership_potential}`
          : '',
        typeof linkedCompany?.total_referrals === 'number'
          ? `Referrals · ${linkedCompany.total_referrals}`
          : '',
        contact.owner_name ? `Owner · ${contact.owner_name}` : '',
      ].filter(Boolean),
    },
  })
}
