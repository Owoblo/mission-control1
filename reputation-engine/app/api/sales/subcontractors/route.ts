import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { listSubcontractorOffers, listSubcontractors, saveSubcontractor } from '@/lib/server/subcontractors'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { buildOfferDefaults } from '@/lib/subcontractors'
import { derivePartnerJobReadiness } from '@/lib/subcontractor-briefing'
import type { Subcontractor } from '@/lib/subcontractors'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const leadId = new URL(request.url).searchParams.get('leadId')
    const lead = leadId ? await getSalesLead(leadId) : null
    if (leadId && (!lead || !leadMatchesSessionBranch(lead, session))) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const quote = lead?.quoteId ? await getSalesQuote(lead.quoteId) : null
    const [contractors, offers] = await Promise.all([listSubcontractors(), listSubcontractorOffers(leadId || undefined)])
    return NextResponse.json({ contractors, offers, job: lead ? { leadId: lead.id, quoteId: quote?.id, name: lead.name, ...buildOfferDefaults(lead, quote), partnerReadiness: derivePartnerJobReadiness(lead, quote) } : null })
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load contractors' }, { status: 500 }) }
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Partial<Subcontractor>
  if (!body.companyName?.trim() || !body.contactName?.trim() || !body.phone?.trim()) return NextResponse.json({ error: 'Company, contact, and phone are required.' }, { status: 400 })
  if (session?.branch && body.branches?.length && !body.branches.includes(session.branch)) return NextResponse.json({ error: 'Contractor is outside your branch.' }, { status: 403 })
  try { return NextResponse.json({ contractor: await saveSubcontractor(body as Partial<Subcontractor> & Pick<Subcontractor, 'companyName' | 'contactName' | 'phone'>) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save contractor' }, { status: 500 }) }
}
