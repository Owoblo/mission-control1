import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { radarDb, readRadar } from '@/lib/server/follow-up-radar'
import { radarState, validateFollowUpPlan } from '@/lib/follow-up-radar'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const data = await readRadar()
    return NextResponse.json({
      leads: data.leads.filter(l => leadMatchesSessionBranch(l, session)).map(l => ({
        id: l.id, name: l.name, phone: l.phone, email: l.email, branch: l.branch, stage: l.stage,
        followUpPlan: l.followUpPlan, state: radarState(l), canEdit: canEditLead(session, l),
      })),
      opportunities: session?.role === 'owner' || session?.role === 'manager' && !session.branch ? data.opportunities : [],
      actor: session?.name,
    })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load radar.' }, { status: 500 }) }
}
export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    if (typeof body.id !== 'string') throw new Error('Lead identifier required.')
    validateFollowUpPlan(body.plan)
    const [record] = await radarDb('crm_leads', { id: `eq.${body.id}`, deleted: 'eq.false', select: 'id,data,updated_at' })
    if (!record || !leadMatchesSessionBranch(record.data, session)) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    if (!canEditLead(session, record.data)) return NextResponse.json({ error: 'This lead belongs to another representative.' }, { status: 403 })
    if ((record.data.followUpPlan?.reviewedAt || null) !== (body.previousReviewedAt || null)) return NextResponse.json({ error: 'The plan changed. Reload before saving.' }, { status: 409 })
    if (session?.role === 'sales_rep' && body.plan.ownerName !== session.name && body.plan.ownerName !== (record.data.followUpPlan?.ownerName || record.data.assignedRepName)) throw new Error('Ask a manager to reassign the owner.')
    if (radarState(record.data).lastActivity !== body.previousActivityAt) return NextResponse.json({ error: 'New conversation activity arrived. Reload and review it before saving.' }, { status: 409 })
    const plan = { ...body.plan, reviewedAt: new Date().toISOString(), reviewedBy: session?.name || 'Sales' }
    // Preserve every unrelated field and the full conversation. Do not trigger messages or change stage.
    const saved = await radarDb('crm_leads', { id: `eq.${body.id}`, deleted: 'eq.false', updated_at: `eq.${record.updated_at}` }, 'PATCH', {
      data: { ...record.data, followUpPlan: plan, followUpPlanHistory: [...(record.data.followUpPlanHistory || []), record.data.followUpPlan].filter(Boolean).slice(-50) },
      updated_at: plan.reviewedAt,
    })
    if (!saved.length) return NextResponse.json({ error: 'Lead changed during save. Reload.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save plan.' }, { status: 400 }) }
}
