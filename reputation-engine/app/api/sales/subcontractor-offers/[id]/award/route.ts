import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { awardOffer, listSubcontractorOffers } from '@/lib/server/subcontractors'
import { getSalesLead } from '@/lib/server/sales-repository'
import { handoffAwardToCrew } from '@/lib/server/subcontractor-award'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { subcontractorId?: string }
  const offer = (await listSubcontractorOffers()).find(item => item.id === id)
  const lead = offer ? await getSalesLead(offer.leadId) : null
  if (!offer || !lead || !leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  if (!body.subcontractorId || !offer.recipients?.some(item => item.subcontractorId === body.subcontractorId)) return NextResponse.json({ error: 'Select a recipient.' }, { status: 400 })
  try {
    if (!await awardOffer(id, body.subcontractorId)) return NextResponse.json({ error: 'Offer is no longer open.' }, { status: 409 })
    return NextResponse.json({ lead: await handoffAwardToCrew(id, body.subcontractorId) })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not award offer' }, { status: 500 }) }
}
