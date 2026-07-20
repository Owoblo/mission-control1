import { NextResponse } from 'next/server'
import { buildDefaultMoveExecutionEntries, MOVE_EXECUTION_PHASES, normalizeMoveExecutionLog } from '@/lib/move-execution'
import { deriveJobReadiness } from '@/lib/job-spine'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'
import type { CRMLead, MoveExecutionPhase } from '@/lib/types'

function canUpdateJob(lead: CRMLead, session: Awaited<ReturnType<typeof getSessionUser>>) {
  if (!session) return false
  if (session.role === 'owner' || session.role === 'manager') return true
  if (session.role === 'operations_lead') return !session.branch || !lead.branch || session.branch === lead.branch
  if (session.role !== 'crew') return false
  const keys = new Set([session.userId, session.name].filter(Boolean))
  return (lead.assignedCrew || []).some(member => keys.has(member))
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    if (!canUpdateJob(lead, session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json() as { phase?: MoveExecutionPhase; note?: string; readinessOverrideReason?: string }
    const phaseMeta = MOVE_EXECUTION_PHASES.find(item => item.phase === body.phase)
    if (!phaseMeta) return NextResponse.json({ error: 'Valid execution phase required' }, { status: 400 })

    if (phaseMeta.phase === 'crew_depart_yard') {
      const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null
      const readiness = deriveJobReadiness(lead, quote)
      const canOverride = session?.role === 'owner' || session?.role === 'manager' || session?.role === 'operations_lead'
      const overrideReason = body.readinessOverrideReason?.trim()
      if (readiness.status !== 'fully_ready' && !(canOverride && overrideReason)) {
        return NextResponse.json({
          error: 'This job is not fully ready to dispatch.',
          code: 'JOB_NOT_READY',
          readiness,
          requiredAction: canOverride
            ? 'Resolve the missing requirements or record a management override reason.'
            : 'Ask Operations to resolve the missing requirements before departure.',
        }, { status: 409 })
      }
    }

    const entries = buildDefaultMoveExecutionEntries(lead.moveExecutionLog?.entries)
    const targetIndex = entries.findIndex(entry => entry.phase === phaseMeta.phase)
    const previousIncomplete = entries.slice(0, targetIndex).find(entry => !entry.timestamp)
    if (previousIncomplete) {
      return NextResponse.json({ error: `Complete “${previousIncomplete.label}” first.` }, { status: 409 })
    }

    const now = new Date().toISOString()
    const nextEntries = entries.map(entry => entry.phase === phaseMeta.phase ? {
      ...entry,
      timestamp: entry.timestamp || now,
      note: body.note?.trim() || entry.note,
      loggedAt: now,
      loggedBy: session?.name || session?.userId || 'Crew',
    } : entry)
    const moveExecutionLog = normalizeMoveExecutionLog({ ...lead.moveExecutionLog, entries: nextEntries }, {
      actorName: session?.name,
    })
    const saved = await saveSalesLead({
      ...lead,
      moveExecutionLog,
      stage: phaseMeta.phase === 'return_yard' && lead.stage === 'booked' ? 'completed' : lead.stage,
      lastTouchedAt: now,
      lastTouchedByUserId: session?.userId,
      lastTouchedByName: session?.name,
    })
    return NextResponse.json({ ok: true, lead: saved, phase: phaseMeta.phase })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update job progress' }, { status: 500 })
  }
}
