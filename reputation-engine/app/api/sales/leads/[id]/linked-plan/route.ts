import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLeadForUpdate, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'
import { loadLinkedMovePlan } from '@/lib/server/linked-move-plan'

type Context = { params: Promise<{ id: string }> }
async function load(context: Context) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) throw new Error('Unauthorized')
  const { id } = await context.params
  const record = await getSalesLeadForUpdate(id)
  if (!record || !leadMatchesSessionBranch(record.lead, session)) throw new Error('Not found')
  const quote = record.lead.quoteId ? await getSalesQuote(record.lead.quoteId) : null
  return { session, record, ...await loadLinkedMovePlan(record.lead, quote) }
}
const failure = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Could not load combined plan'
  return NextResponse.json({ error: message }, { status: message === 'Unauthorized' ? 401 : message === 'Not found' ? 404 : 400 })
}
export async function GET(_: Request, context: Context) {
  try { const { plan } = await load(context); return NextResponse.json({ plan }) } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const { session, record, plan } = await load(context)
    if (!canAccessOperationsWorkspace(session) || !canEditLead(session, record.lead)) return NextResponse.json({ error: 'Operations or a manager must review the combined plan.' }, { status: 403 })
    const body = await request.json() as { fingerprint: string; instructions: string; plannedHours: number }
    if (body.fingerprint !== plan.fingerprint) return NextResponse.json({ error: 'The combined scope changed. Reload and review it again.' }, { status: 409 })
    if (!plan.approved.length) throw new Error('Customer approval of the additional quote is required before dispatch review.')
    if (plan.reasons.length) throw new Error(plan.reasons.join(' '))
    if (typeof body.instructions !== 'string' || body.instructions.trim().length < 30 || body.instructions.length > 8000) throw new Error('Record stop order, access/time windows, loading sequence and crew instructions (30–8000 characters).')
    if (!Number.isFinite(body.plannedHours) || body.plannedHours <= 0 || body.plannedHours > 168) throw new Error('Enter the total operational hours for this combined move.')
    if (body.plannedHours < plan.assemblyHours) throw new Error('Combined working hours cannot be less than the assembly tasks alone.')
    const review = { fingerprint: plan.fingerprint, reviewedAt: new Date().toISOString(), reviewedBy: session?.name || 'Operations', instructions: body.instructions.trim(), plannedHours: body.plannedHours }
    await saveSalesLead({ ...record.lead, linkedPlanReview: review, linkedPlanReviewHistory: [...(record.lead.linkedPlanReviewHistory || []), review] }, record.updatedAt)
    return NextResponse.json({ ok: true })
  } catch (error) { return failure(error) }
}
