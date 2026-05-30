import { NextResponse } from 'next/server'
import { deriveOpsChecklist, getQuotedTruckCount, isTruckReservationComplete, normalizeCrewHours, normalizeCrewPayouts } from '@/lib/operations'
import { calculateLeadScore, getLeadAssignedRepName, normalizeLead, syncLeadFromQuoteStatus } from '@/lib/sales'
import { logEvent, daysBetween } from '@/lib/server/analytics'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'
import { scheduleMoveReminder } from '@/lib/server/sales-automation'
import { getBookedJobFieldDiffs, recordLeadArchivedAudit, recordLeadUpdateAudit, sendBookedJobChangeNotice } from '@/lib/server/sales-audit'
import { applyDetectedBranch, maybeCreateDestinationOpportunityLead } from '@/lib/server/sales-opportunities'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace, canDeleteLead, canReassignLead, isLeadOwnedBySession } from '@/lib/server/sales-permissions'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getSessionUser } from '@/lib/server/session'
import { validateLeadPatchPayload } from '@/lib/server/sales-validation'
import {
  deleteSalesLead,
  getSalesClient,
  getSalesLead,
  getSalesQuote,
  saveSalesClient,
  saveSalesLead,
  saveSalesQuote,
} from '@/lib/server/sales-repository'

function normalizeOptional(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function hasOwn(source: object, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key)
}

const OPERATIONS_EDITABLE_FIELDS = new Set([
  'assignedCrew',
  'crewNote',
  'crewHours',
  'crewPayouts',
  'truckReservationStatus',
  'truckVendor',
  'truckSize',
  'truckPickupLocation',
  'truckPickupTime',
  'truckReturnLocation',
  'truckReservationNumber',
  'truckReservationNotes',
  'opsChecklist',
])

function isOperationsOnlyUpdate(updates: Partial<import('@/lib/types').CRMLead>) {
  const keys = Object.keys(updates)
  return keys.length > 0 && keys.every(key => OPERATIONS_EDITABLE_FIELDS.has(key))
}

function canManageOperationsLead(
  session: Awaited<ReturnType<typeof getSessionUser>>,
  lead: import('@/lib/types').CRMLead
) {
  if (!canAccessOperationsWorkspace(session)) return false
  if (session?.role === 'owner' || session?.role === 'manager') return true
  if (session?.role === 'operations_lead') {
    return !session.branch || !lead.branch || session.branch === lead.branch
  }
  return false
}

function applyCrewPayoutWorkflowMetadata(
  currentEntries: import('@/lib/types').CRMLead['crewPayouts'],
  nextEntries: import('@/lib/types').CRMLead['crewPayouts'],
  actorName?: string
) {
  if (!nextEntries?.length) return nextEntries
  const actor = normalizeOptional(actorName)
  const now = new Date().toISOString()
  const currentById = new Map((currentEntries || []).map(entry => [entry.id, entry]))

  return nextEntries.map(entry => {
    const previous = currentById.get(entry.id)
    const payoutStatus = entry.payoutStatus || previous?.payoutStatus || 'submitted'
    const approved = payoutStatus === 'approved' || payoutStatus === 'paid'
    const paid = payoutStatus === 'paid'

    return {
      ...previous,
      ...entry,
      payoutStatus,
      submittedAt: previous?.submittedAt || entry.submittedAt || now,
      approvedAt: approved ? (entry.approvedAt || previous?.approvedAt || now) : undefined,
      approvedBy: approved ? (normalizeOptional(entry.approvedBy) || previous?.approvedBy || actor) : undefined,
      paidAt: paid ? (entry.paidAt || previous?.paidAt || now) : undefined,
      paidBy: paid ? (normalizeOptional(entry.paidBy) || previous?.paidBy || actor) : undefined,
      createdAt: previous?.createdAt || entry.createdAt || now,
      updatedAt: now,
    }
  })
}

function applyOperationalDefaults(
  current: import('@/lib/types').CRMLead,
  nextLead: import('@/lib/types').CRMLead,
  quote: import('@/lib/types').CRMQuote | null,
  actorName?: string
) {
  const assignedCrew = Array.from(new Set((nextLead.assignedCrew || []).filter(Boolean)))
  const stagedCrewPayouts = applyCrewPayoutWorkflowMetadata(current.crewPayouts, nextLead.crewPayouts, actorName)
  const quotedTruckCount = getQuotedTruckCount(nextLead, quote)
  const truckReservationStatus = quotedTruckCount
    ? (nextLead.truckReservationStatus || current.truckReservationStatus || 'needs_booking')
    : 'not_needed'
  const truckReservationBookedAt = isTruckReservationComplete(truckReservationStatus)
    ? (current.truckReservationBookedAt || nextLead.truckReservationBookedAt || new Date().toISOString())
    : nextLead.truckReservationBookedAt
  const truckReservationBookedBy = isTruckReservationComplete(truckReservationStatus)
    ? (current.truckReservationBookedBy || nextLead.truckReservationBookedBy || normalizeOptional(actorName))
    : nextLead.truckReservationBookedBy

  const normalizedLead = {
    ...nextLead,
    assignedCrew: assignedCrew.length > 0 ? assignedCrew : undefined,
    crewHours: normalizeCrewHours(nextLead.crewHours, assignedCrew),
    crewPayouts: normalizeCrewPayouts(stagedCrewPayouts),
    truckCountConfirmed: quotedTruckCount,
    truckSize: quotedTruckCount ? normalizeOptional(nextLead.truckSize) || current.truckSize || '26ft' : undefined,
    truckReservationStatus,
    truckVendor: truckReservationStatus === 'not_needed' ? undefined : nextLead.truckVendor,
    truckPickupLocation: truckReservationStatus === 'not_needed' ? undefined : normalizeOptional(nextLead.truckPickupLocation),
    truckPickupTime: truckReservationStatus === 'not_needed' ? undefined : normalizeOptional(nextLead.truckPickupTime),
    truckReturnLocation: truckReservationStatus === 'not_needed' ? undefined : normalizeOptional(nextLead.truckReturnLocation),
    truckReservationNumber: truckReservationStatus === 'not_needed' ? undefined : normalizeOptional(nextLead.truckReservationNumber),
    truckReservationNotes: truckReservationStatus === 'not_needed' ? undefined : normalizeOptional(nextLead.truckReservationNotes),
    truckReservationBookedAt,
    truckReservationBookedBy,
  }

  return {
    ...normalizedLead,
    opsChecklist: deriveOpsChecklist(normalizedLead),
  }
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
  const nextDestAddress = normalizeOptional(saved.destAddress)
  const nextDestCity = normalizeOptional(saved.destCity)

  const quoteNeedsSync =
    normalizeOptional(current.moveDate) !== nextMoveDate ||
    normalizeOptional(current.originAddress) !== nextOriginAddress ||
    normalizeOptional(current.originCity) !== nextOriginCity ||
    normalizeOptional(current.destAddress) !== nextDestAddress ||
    normalizeOptional(current.destCity) !== nextDestCity

  const quoteLocked = quote.status === 'accepted' || quote.status === 'invoiced' || !!quote.acceptedAt
  const syncedQuote = quoteNeedsSync
    ? quoteLocked
      ? quote
      : await saveSalesQuote({
        ...quote,
        moveDate: nextMoveDate,
        originAddress: nextOriginAddress,
        originCity: nextOriginCity,
        destAddress: nextDestAddress,
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
    if (!lead.phone) return
    const firstName = lead.name?.split(' ')[0] || 'there'
    const isConsultation = !!lead.consultationTriggerReason
    let dateTimeStr = ''
    if (lead.estimateDate) {
      const d = new Date(lead.estimateDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
      dateTimeStr = lead.estimateTime ? `${d} at ${lead.estimateTime}` : d
    }
    const managerLine = lead.consultationAssignedManagerName ? ` ${lead.consultationAssignedManagerName} will be your local representative.` : ''
    const body = isConsultation
      ? `Hi ${firstName}! Your In-Home Move Consultation with Saturn Star Movers is confirmed${dateTimeStr ? ` for ${dateTimeStr}` : ''}.${managerLine} Our team has already reviewed your listing photos and will arrive prepared with a preliminary move plan. If anything changes, call or text us at 226-773-2993. See you soon! 🌟`
      : `Hi ${firstName}! This is Saturn Star Moving — confirming your in-home estimate${dateTimeStr ? ` for ${dateTimeStr}` : ''}. We'll review your items and prepare your personalized quote. Questions? Call or text 226-773-2993. See you soon! 🌟`
    await sendSalesMessage({
      channel: 'sms',
      to: lead.phone,
      body,
      leadId: lead.id,
      actor: 'automation',
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

    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const rawBody = (await request.json()) as Partial<typeof current> & { sendAppointmentSms?: boolean }
    const { sendAppointmentSms: sendApptSmsFlag, ...rawUpdates } = rawBody
    const updates = validateLeadPatchPayload(rawUpdates)
    const salesWorkspaceUser = canAccessSalesWorkspace(session)
    const operationsOnlyUpdate = isOperationsOnlyUpdate(updates)

    if (!salesWorkspaceUser) {
      if (!canManageOperationsLead(session, current)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!operationsOnlyUpdate) {
        return NextResponse.json({ error: 'Operations users can only update dispatch fields.' }, { status: 403 })
      }
    }

    const assignmentRequested =
      hasOwn(updates, 'assignedRep') ||
      hasOwn(updates, 'assignedRepName') ||
      hasOwn(updates, 'assignedRepUserId')

    if (salesWorkspaceUser && assignmentRequested && !canReassignLead(session)) {
      const requestedAssignedRep = normalizeOptional(updates.assignedRepName) || normalizeOptional(updates.assignedRep)
      const requestedAssignedRepUserId = normalizeOptional(updates.assignedRepUserId)
      const currentAssignedRep = getLeadAssignedRepName(current)
      const claimingSelf =
        !currentAssignedRep &&
        (
          (!!requestedAssignedRepUserId && requestedAssignedRepUserId === session?.userId) ||
          (!!requestedAssignedRep && requestedAssignedRep === normalizeOptional(session?.name))
        )
      // Allow through if the assignment values aren't actually changing (rep saving other fields)
      const notActuallyChangingAssignment =
        (!requestedAssignedRepUserId || requestedAssignedRepUserId === normalizeOptional(current.assignedRepUserId)) &&
        (!requestedAssignedRep || requestedAssignedRep === currentAssignedRep)

      if (!claimingSelf && !notActuallyChangingAssignment) {
        return NextResponse.json({ error: 'Only managers can reassign leads between reps.' }, { status: 403 })
      }
    }

    let nextLead = normalizeLead({
      ...current,
      ...updates,
      id: current.id,
    })

    const quote = nextLead.quoteId ? await getSalesQuote(nextLead.quoteId).catch(() => null) : null

    if (nextLead.quoteId && updates.stage === undefined && quote) {
      nextLead = syncLeadFromQuoteStatus(nextLead, quote)
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
    nextLead = normalizeLead(applyOperationalDefaults(current, nextLead, quote, session?.name))

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

    const bookedJobDiffs = getBookedJobFieldDiffs(current, syncedOpportunityLead)
    if (bookedJobDiffs.some(diff => diff.customerFacing)) {
      const linkedQuote = syncedOpportunityLead.quoteId ? await getSalesQuote(syncedOpportunityLead.quoteId).catch(() => null) : null
      void sendBookedJobChangeNotice(syncedOpportunityLead, linkedQuote, bookedJobDiffs, {
        actorName: session?.name,
        actorUserId: session?.userId,
      }).catch(() => {})
    }

    // Analytics — fire background events for key transitions
    const stageChanged = current.stage !== syncedOpportunityLead.stage
    if (stageChanged) {
      void logEvent('lead_stage_changed', {
        actorName: session?.name,
        actorUserId: session?.userId,
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
        actorName: session?.name,
        actorUserId: session?.userId,
        lead: syncedOpportunityLead,
        properties: {
          lost_reason: syncedOpportunityLead.lostReason,
          lost_notes: syncedOpportunityLead.lostNotes,
          days_from_lead_to_loss: daysBetween(syncedOpportunityLead.createdAt, new Date().toISOString()),
          touchpoint_count: (syncedOpportunityLead.callLogs || []).length,
        },
      })
    }
    // Send appointment confirmation SMS only when explicitly requested by the rep
    if (sendApptSmsFlag === true && syncedOpportunityLead.stage === 'estimate_scheduled' && syncedOpportunityLead.phone) {
      void sendAppointmentSms(syncedOpportunityLead)
    }

    if (syncedOpportunityLead.stage === 'booked' && current.stage !== 'booked') {
      void scheduleMoveReminder(syncedOpportunityLead.id)
      void logEvent('job_booked', {
        actorName: session?.name,
        actorUserId: session?.userId,
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
        actorName: session?.name,
        actorUserId: session?.userId,
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

    const needsIntelligenceRefresh =
      stageChanged ||
      Object.prototype.hasOwnProperty.call(updates, 'contextFlag') ||
      Object.prototype.hasOwnProperty.call(updates, 'moveDate') ||
      Object.prototype.hasOwnProperty.call(updates, 'moveDateFlexible') ||
      Object.prototype.hasOwnProperty.call(updates, 'moveType') ||
      Object.prototype.hasOwnProperty.call(updates, 'originAddress') ||
      Object.prototype.hasOwnProperty.call(updates, 'destAddress') ||
      Object.prototype.hasOwnProperty.call(updates, 'notes')

    if (needsIntelligenceRefresh) {
      queueLeadIntelligenceRefresh(syncedOpportunityLead.id, new URL(request.url).origin)
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
