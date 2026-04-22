import { NextResponse } from 'next/server'
import { calculateLeadScore, getLeadAssignedRepName, normalizeLead, syncLeadFromQuoteStatus } from '@/lib/sales'
import { logEvent, daysBetween } from '@/lib/server/analytics'
import { scheduleMoveReminder } from '@/lib/server/sales-automation'
import { recordLeadArchivedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { applyDetectedBranch, maybeCreateDestinationOpportunityLead } from '@/lib/server/sales-opportunities'
import { canAccessSalesWorkspace, canDeleteLead, canEditLead, canReassignLead, isLeadOwnedBySession } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import {
  deleteSalesLead,
  getSalesClient,
  getSalesLead,
  getSalesQuote,
  saveSalesClient,
  saveSalesLead,
  saveSalesQuote,
} from '@/lib/server/sales-repository'
import { getWorkerSharedSecret, requireWorkerBaseUrl } from '@/lib/server/runtime'

function normalizeOptional(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function hasOwn(source: object, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function applyOwnershipMetadata(
  current: import('@/lib/types').CRMLead,
  nextLead: import('@/lib/types').CRMLead,
  updates: Partial<import('@/lib/types').CRMLead>,
  session: Awaited<ReturnType<typeof getSessionUser>>
) {
  const now = new Date().toISOString()
  const previousAssignedRep = getLeadAssignedRepName(current)
  const previousAssignedRepUserId = normalizeOptional(current.assignedRepUserId)
  const assignmentFieldProvided =
    hasOwn(updates, 'assignedRep') ||
    hasOwn(updates, 'assignedRepName') ||
    hasOwn(updates, 'assignedRepUserId')

  let nextAssignedRep = getLeadAssignedRepName(nextLead)
  let nextAssignedRepUserId = normalizeOptional(nextLead.assignedRepUserId)

  if (assignmentFieldProvided) {
    nextAssignedRepUserId = normalizeOptional(updates.assignedRepUserId)
    nextAssignedRep =
      normalizeOptional(updates.assignedRepName) ||
      normalizeOptional(updates.assignedRep)

    if (!nextAssignedRep && nextAssignedRepUserId && nextAssignedRepUserId === previousAssignedRepUserId) {
      nextAssignedRep = previousAssignedRep
    }

    if (!nextAssignedRep && nextAssignedRepUserId && nextAssignedRepUserId === session?.userId) {
      nextAssignedRep = normalizeOptional(session.name)
    }

    if (!nextAssignedRep) {
      nextAssignedRepUserId = undefined
    }
  }

  const ownershipChanged =
    previousAssignedRep !== nextAssignedRep ||
    previousAssignedRepUserId !== nextAssignedRepUserId

  const normalizedLead = normalizeLead({
    ...nextLead,
    assignedRep: nextAssignedRep,
    assignedRepName: nextAssignedRep,
    assignedRepUserId: nextAssignedRepUserId,
    leadOwnerStatus: ownershipChanged
      ? (nextAssignedRep ? (previousAssignedRep ? 'reassigned' : 'assigned') : 'unassigned')
      : nextLead.leadOwnerStatus,
    ownedAt: nextAssignedRep
      ? (ownershipChanged ? now : nextLead.ownedAt || current.ownedAt || now)
      : undefined,
    lastTouchedByUserId: session?.userId || nextLead.lastTouchedByUserId || current.lastTouchedByUserId,
    lastTouchedByName: normalizeOptional(session?.name) || nextLead.lastTouchedByName || current.lastTouchedByName,
    lastTouchedAt: session?.userId ? now : nextLead.lastTouchedAt || current.lastTouchedAt,
  })

  return {
    nextLead: normalizedLead,
    ownershipChanged,
    previousAssignedRep,
    nextAssignedRep,
  }
}

async function syncLinkedQuoteAndClientFromLead(current: import('@/lib/types').CRMLead, saved: import('@/lib/types').CRMLead) {
  if (!saved.quoteId) return

  const quote = await getSalesQuote(saved.quoteId)
  if (!quote) return

  const nextMoveDate = normalizeOptional(saved.moveDate)
  const nextOriginAddress = normalizeOptional(saved.originAddress)
  const nextOriginCity = normalizeOptional(saved.originCity)
  const nextDestCity = normalizeOptional(saved.destCity)

  const quoteNeedsSync =
    normalizeOptional(current.moveDate) !== nextMoveDate ||
    normalizeOptional(current.originAddress) !== nextOriginAddress ||
    normalizeOptional(current.originCity) !== nextOriginCity ||
    normalizeOptional(current.destCity) !== nextDestCity

  const syncedQuote = quoteNeedsSync
    ? await saveSalesQuote({
        ...quote,
        moveDate: nextMoveDate,
        originAddress: nextOriginAddress,
        originCity: nextOriginCity,
        destCity: nextDestCity,
      })
    : quote

  if (!syncedQuote.clientId) return

  const client = await getSalesClient(syncedQuote.clientId)
  if (!client) return

  const nextClientName = normalizeOptional(saved.name)
  const nextClientEmail = normalizeOptional(saved.email)
  const nextClientPhone = normalizeOptional(saved.phone)

  const clientNeedsSync =
    normalizeOptional(current.name) !== nextClientName ||
    normalizeOptional(current.email) !== nextClientEmail ||
    normalizeOptional(current.phone) !== nextClientPhone

  if (!clientNeedsSync) return

  await saveSalesClient({
    ...client,
    name: nextClientName || client.name,
    email: nextClientEmail,
    phone: nextClientPhone,
  })
}

async function sendAppointmentSms(lead: import('@/lib/types').CRMLead) {
  try {
    const workerSecret = getWorkerSharedSecret()
    if (!workerSecret || !lead.phone) return
    const dateStr = lead.moveDate ? new Date(lead.moveDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
    const body = `Hi ${lead.name?.split(' ')[0] || 'there'}! This is Saturn Star Moving — just confirming your in-home estimate${dateStr ? ` for ${dateStr}` : ''}. We'll take a look at your items and put together your personalized quote on the spot. Any questions, call or text us at 226-773-2993. See you soon! 🌟`
    await fetch(`${requireWorkerBaseUrl()}/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': workerSecret },
      body: JSON.stringify({ to: lead.phone, body }),
    })
  } catch {
    // best-effort — never fail the lead update because of this
  }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json(lead)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lead' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!canEditLead(session, current)) {
      return NextResponse.json({ error: 'You can only edit unassigned leads or leads you own.' }, { status: 403 })
    }

    const updates = (await request.json()) as Partial<typeof current>
    const assignmentRequested =
      hasOwn(updates, 'assignedRep') ||
      hasOwn(updates, 'assignedRepName') ||
      hasOwn(updates, 'assignedRepUserId')

    if (assignmentRequested && !canReassignLead(session)) {
      const requestedAssignedRep = normalizeOptional(updates.assignedRepName) || normalizeOptional(updates.assignedRep)
      const requestedAssignedRepUserId = normalizeOptional(updates.assignedRepUserId)
      const currentAssignedRep = getLeadAssignedRepName(current)
      const claimingSelf =
        !currentAssignedRep &&
        (
          (!!requestedAssignedRepUserId && requestedAssignedRepUserId === session?.userId) ||
          (!!requestedAssignedRep && requestedAssignedRep === normalizeOptional(session?.name))
        )
      const keepingSelfAssignment =
        isLeadOwnedBySession(current, session) &&
        (
          (!requestedAssignedRepUserId || requestedAssignedRepUserId === normalizeOptional(current.assignedRepUserId)) &&
          (!requestedAssignedRep || requestedAssignedRep === currentAssignedRep)
        )

      if (!claimingSelf && !keepingSelfAssignment) {
        return NextResponse.json({ error: 'Only managers can reassign leads between reps.' }, { status: 403 })
      }
    }

    let nextLead = normalizeLead({
      ...current,
      ...updates,
      id: current.id,
    })

    if (nextLead.quoteId && updates.stage === undefined) {
      const quote = await getSalesQuote(nextLead.quoteId)
      if (quote) {
        nextLead = syncLeadFromQuoteStatus(nextLead, quote)
      }
    }

    // When Date TBD is active and no explicit followUpDate was sent in this update,
    // keep a rolling 3-day follow-up so the lead never goes cold
    if (nextLead.moveDateFlexible && !updates.followUpDate) {
      const threeDaysOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      nextLead = { ...nextLead, followUpDate: threeDaysOut, followUpNote: nextLead.followUpNote || 'Check in — pending house close' }
    }

    nextLead = normalizeLead({
      ...nextLead,
      leadScore: calculateLeadScore(nextLead),
    })
    nextLead = applyDetectedBranch(nextLead)

    const ownership = applyOwnershipMetadata(current, nextLead, updates, session)
    nextLead = ownership.nextLead

    const enteringRepOwnedStage =
      (nextLead.stage === 'estimate_scheduled' && current.stage !== 'estimate_scheduled') ||
      (nextLead.stage === 'estimate_completed' && current.stage !== 'estimate_completed')

    const repAssigned = ownership.ownershipChanged && !!ownership.nextAssignedRep
    if (enteringRepOwnedStage || repAssigned) {
      nextLead = {
        ...nextLead,
        automationStatus: enteringRepOwnedStage ? 'handoff' : 'paused',
        automationPausedUntil: new Date(Date.now() + (enteringRepOwnedStage ? 24 : 6) * 60 * 60 * 1000).toISOString(),
        automationPauseReason: enteringRepOwnedStage ? 'estimate_or_rep_workflow' : 'rep_assigned',
        automationHandoffAt: enteringRepOwnedStage ? new Date().toISOString() : nextLead.automationHandoffAt,
        automationHandoffReason: enteringRepOwnedStage
          ? 'Lead is in estimate / rep-owned workflow.'
          : nextLead.automationHandoffReason,
      }
    }

    const saved = await saveSalesLead(nextLead)
    await recordLeadUpdateAudit(current, saved)
    const syncedOpportunityLead = await maybeCreateDestinationOpportunityLead(current, saved)
    if (syncedOpportunityLead.id === saved.id && JSON.stringify(syncedOpportunityLead) !== JSON.stringify(saved)) {
      await recordLeadUpdateAudit(saved, syncedOpportunityLead)
    }
    await syncLinkedQuoteAndClientFromLead(current, syncedOpportunityLead)

    // Analytics — fire background events for key transitions
    const stageChanged = current.stage !== syncedOpportunityLead.stage
    if (stageChanged) {
      void logEvent('lead_stage_changed', {
        lead: syncedOpportunityLead,
        properties: {
          lead_prev_stage: current.stage,
          lead_stage: syncedOpportunityLead.stage,
          days_in_stage: daysBetween(current.createdAt, new Date().toISOString()),
        },
      })
    }
    if (syncedOpportunityLead.stage === 'lost' && current.stage !== 'lost') {
      void logEvent('lead_lost', {
        lead: syncedOpportunityLead,
        properties: {
          lost_reason: syncedOpportunityLead.lostReason,
          lost_notes: syncedOpportunityLead.lostNotes,
          days_from_lead_to_loss: daysBetween(syncedOpportunityLead.createdAt, new Date().toISOString()),
          touchpoint_count: (syncedOpportunityLead.callLogs || []).length,
        },
      })
    }
    // Auto-send appointment confirmation SMS when estimate is scheduled
    if (syncedOpportunityLead.stage === 'estimate_scheduled' && current.stage !== 'estimate_scheduled' && syncedOpportunityLead.phone) {
      void sendAppointmentSms(syncedOpportunityLead)
    }

    if (syncedOpportunityLead.stage === 'booked' && current.stage !== 'booked') {
      void scheduleMoveReminder(syncedOpportunityLead.id)
      void logEvent('job_booked', {
        lead: syncedOpportunityLead,
        properties: {
          days_from_lead_to_booked: daysBetween(syncedOpportunityLead.createdAt, new Date().toISOString()),
          touchpoints_to_close: (syncedOpportunityLead.callLogs || []).length,
          deposit_method: syncedOpportunityLead.depositMethod,
          deposit_amount: syncedOpportunityLead.depositAmount,
        },
      })
    }
    if (ownership.ownershipChanged) {
      void logEvent('lead_assigned', {
        lead: syncedOpportunityLead,
        repId: syncedOpportunityLead.assignedRepUserId || syncedOpportunityLead.assignedRep,
        properties: {
          assigned_rep: ownership.nextAssignedRep,
          assigned_rep_user_id: syncedOpportunityLead.assignedRepUserId,
          previous_assigned_rep: ownership.previousAssignedRep,
          assigned_by_user_id: session?.userId,
          assigned_by_name: session?.name,
          lead_owner_status: syncedOpportunityLead.leadOwnerStatus,
        },
      })
    }

    return NextResponse.json(syncedOpportunityLead)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update lead' },
      { status: 400 }
    )
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canDeleteLead(session)) {
      return NextResponse.json({ error: 'Only managers or owners can delete leads.' }, { status: 403 })
    }

    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    await deleteSalesLead(params.id)
    await recordLeadArchivedAudit(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete lead' },
      { status: 400 }
    )
  }
}
