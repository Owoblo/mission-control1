import { preserveInventoryHandlingEvidence } from '@/lib/assembly-planning'
import { NextResponse } from 'next/server'
import { buildCurrentCrewBrief, buildMoveOperatingPlan } from '@/lib/move-operating-plan'
import { PLANNING_TRUCKS } from '@/lib/truck-planning'
import type { AssemblyInstructions } from '@/lib/assembly-planning'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLeadForUpdate, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const record = await getSalesLeadForUpdate(id)
    const lead = record?.lead
    if (!lead || !leadMatchesSessionBranch(lead, session) || (session?.role === 'operations_lead' && session.branch && session.branch !== lead.branch)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canAccessOperationsWorkspace(session) && !canEditLead(session, lead)) return NextResponse.json({ error: 'This lead is assigned to another representative.' }, { status: 403 })
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId) : null
    const body = await request.json() as { fingerprint: string; approve?: boolean; rationale?: string; plannedHours?: number;
      truckSize?: string; originAccess?: string; destAccess?: string; parkingNotes?: string; moveTime?: string;
      items?: Array<{ id: string; notes?: string; assembly?: AssemblyInstructions }> }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Planning details must be an object.')
    if (body.approve !== undefined && typeof body.approve !== 'boolean') throw new Error('Approval must be true or false.')
    for (const key of ['fingerprint', 'rationale', 'truckSize', 'originAccess', 'destAccess', 'parkingNotes', 'moveTime'] as const) {
      if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key]!.length > 8000)) throw new Error(`${key} must be text of at most 8000 characters.`)
    }
    if (body.items !== undefined && (!Array.isArray(body.items) || body.items.length > 500)) throw new Error('Item instructions must be a list of at most 500 items.')
    const itemKeys = (lead.inventory || []).map((item, index) => item.id || `item-${index}`)
    if (new Set(itemKeys).size !== itemKeys.length) throw new Error('Inventory has duplicate identifiers. Reconcile the duplicate items before planning.')
    if (body.fingerprint !== buildMoveOperatingPlan(lead, quote).fingerprint) return NextResponse.json({ error: 'The plan changed. Reload and review the latest inventory and quote.' }, { status: 409 })
    if (body.approve && !canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Operations or a manager must approve the dispatch plan.' }, { status: 403 })
    if (body.truckSize && !Object.hasOwn(PLANNING_TRUCKS, body.truckSize)) throw new Error('Select a supported truck size.')
    if (body.moveTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.moveTime)) throw new Error('Use a valid 24-hour start time.')
    for (const item of body.items || []) {
      if (!item || typeof item.id !== 'string' || (item.notes !== undefined && (typeof item.notes !== 'string' || item.notes.length > 8000))) throw new Error('Each item needs its saved identifier and valid notes.')
      if (!itemKeys.includes(item.id)) throw new Error('Inventory changed; reload before saving item instructions.')
      if (!item.assembly) continue
      const a = item.assembly
      if (!['crew', 'customer', 'not_required'].includes(a.responsibility) || typeof a.evidence !== 'string' || !a.evidence.trim() || a.evidence.length > 4000 ||
        (a.tools !== undefined && (typeof a.tools !== 'string' || a.tools.length > 4000)) ||
        ![a.originMinutes, a.destinationMinutes].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1440) ||
        !Number.isInteger(a.workers) || a.workers < 1 || a.workers > 20) throw new Error('Assembly instructions need evidence, valid minutes at each end and worker count.')
    }
    const next = { ...lead,
      truckSize: body.truckSize || lead.truckSize,
      originAccess: body.originAccess ?? lead.originAccess, destAccess: body.destAccess ?? lead.destAccess,
      parkingNotes: body.parkingNotes ?? lead.parkingNotes, moveTime: body.moveTime || lead.moveTime,
      inventory: (lead.inventory || []).map((item, index) => {
        const update = body.items?.find(candidate => candidate.id === itemKeys[index])
        return update ? { ...item, notes: update.notes ?? item.notes, assembly: update.assembly ?? item.assembly } : item
      }),
    }
    next.inventory = preserveInventoryHandlingEvidence(lead.inventory || [], next.inventory)
    if (body.approve && Number.isFinite(body.plannedHours) && Number(body.plannedHours) > 0) next.jobFactors = { ...next.jobFactors, operationalHoursBudget: Number(body.plannedHours) }
    const plan = buildMoveOperatingPlan(next, quote)
    if (body.approve) {
      if (plan.invalidInventory) throw new Error('Correct invalid inventory quantities, volume or weight before approval.')
      if (!body.rationale?.trim() || body.rationale.trim().length < 20) throw new Error('Record how the truck, assembly, access and time concerns were resolved (at least 20 characters).')
      if (!Number.isFinite(body.plannedHours) || Number(body.plannedHours) <= 0 || Number(body.plannedHours) > 168) throw new Error('Record a valid operational hours budget.')
      if (plan.truckPlan && (!plan.truckPlan.fits || !next.truckSize)) throw new Error('Select sufficient truck capacity before approving. Split trips require a separate scoped plan.')
      if (plan.truckPlan && next.truckReservationStatus === 'not_needed') throw new Error('Correct the “no truck needed” reservation status before approving a truck move.')
      if (plan.assembly.tasks.some(task => task.workers > (quote?.crewSize || 0))) throw new Error('Planned crew cannot perform the assembly tasks; update the crew plan first.')
      if (Number(body.plannedHours) < plan.assembly.hours) throw new Error('Total hours cannot be shorter than the assembly tasks alone.')
      next.operatingReview = { fingerprint: plan.fingerprint, reviewedAt: new Date().toISOString(), reviewedBy: session?.name || 'Operations',
        rationale: body.rationale.trim(), plannedHours: Number(body.plannedHours), snapshot: plan.snapshot }
    }
    if (body.approve && next.operatingReview) next.operatingReviewHistory = [...(lead.operatingReviewHistory || []), next.operatingReview]
    next.crewNote = buildCurrentCrewBrief(next, quote)
    next.opsChecklist = { ...next.opsChecklist, jobPacketReady: buildMoveOperatingPlan(next, quote).ready }
    const saved = await saveSalesLead(next, record!.updatedAt)
    return NextResponse.json({ lead: saved, plan: buildMoveOperatingPlan(saved, quote) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save operating plan.' }, { status: 400 })
  }
}
