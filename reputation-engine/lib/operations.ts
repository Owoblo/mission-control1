import type {
  CRMLead,
  CRMQuote,
  CrewHoursEntry,
  CrewPayoutEntry,
  CrewPayoutMethod,
  CrewPayoutRole,
  CrewPayoutStatus,
  OpsChecklist,
  TruckReservationStatus,
  TruckVendor,
} from './types'

export const TRUCK_RESERVATION_STATUS_LABELS: Record<TruckReservationStatus, string> = {
  not_needed: 'No truck needed',
  needs_booking: 'Needs booking',
  booking_in_progress: 'Booking in progress',
  reserved: 'Reserved',
  issue: 'Issue / follow-up',
}

export const TRUCK_VENDOR_LABELS: Record<TruckVendor, string> = {
  uhaul: 'U-Haul',
  penske: 'Penske',
  budget: 'Budget',
  enterprise: 'Enterprise',
  other: 'Other',
}

export const CREW_PAYOUT_ROLE_LABELS: Record<CrewPayoutRole, string> = {
  crew_lead: 'Crew Lead',
  driver: 'Driver',
  mover: 'Mover',
  other: 'Other',
}

export const CREW_PAYOUT_METHOD_LABELS: Record<CrewPayoutMethod, string> = {
  interac: 'Interac',
  stripe_connect: 'Stripe Connect',
  cash: 'Cash',
  manual: 'Manual',
}

export const CREW_PAYOUT_STATUS_LABELS: Record<CrewPayoutStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
}

export const CREW_DISPATCH_STATUS_LABELS: Record<NonNullable<CrewPayoutEntry['dispatchStatus']>, string> = {
  pending: 'Pending',
  sent: 'Sent',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

export const CREW_ROLE_DEFAULT_RATES: Record<CrewPayoutRole, number> = {
  crew_lead: 25,
  driver: 22,
  mover: 18,
  other: 18,
}

export function isTruckReservationComplete(status?: TruckReservationStatus) {
  return status === 'reserved'
}

export function getQuotedTruckCount(
  lead?: Pick<CRMLead, 'truckCountConfirmed'> | null,
  quote?: Pick<CRMQuote, 'truckCount'> | null
) {
  const count = Number(quote?.truckCount || lead?.truckCountConfirmed || 0)
  if (!Number.isFinite(count) || count <= 0) return undefined
  return Math.max(1, Math.round(count))
}

export function isOneWayTruckPlan(
  lead?: Pick<CRMLead, 'moveType'> | null,
  quote?: Pick<CRMQuote, 'moveType' | 'quoteType'> | null
) {
  return (
    quote?.quoteType === 'long_distance' ||
    quote?.moveType === 'long-distance' ||
    lead?.moveType === 'long-distance'
  )
}

export function getTruckPlanLabel(
  lead?: Pick<CRMLead, 'moveType' | 'truckCountConfirmed' | 'truckSize'> | null,
  quote?: Pick<CRMQuote, 'moveType' | 'quoteType' | 'truckCount'> | null
) {
  const truckCount = getQuotedTruckCount(lead, quote)
  if (!truckCount) return 'No quoted truck requirement yet'

  const truckSize = lead?.truckSize || '26ft'
  const tripType = isOneWayTruckPlan(lead, quote) ? 'One-way' : 'Local return'
  return `${truckCount} x ${truckSize} truck${truckCount === 1 ? '' : 's'} · ${tripType}`
}

export function normalizeCrewHours(
  entries?: CrewHoursEntry[],
  assignedCrew?: string[]
) {
  const assigned = new Set((assignedCrew || []).filter(Boolean))
  if (assigned.size === 0) return undefined

  const normalized = (entries || [])
    .filter(entry => entry?.userId && assigned.has(entry.userId))
    .map(entry => ({
      userId: entry.userId,
      name: entry.name?.trim() || undefined,
      role: entry.role?.trim() || undefined,
      hours: Number.isFinite(Number(entry.hours)) ? Number(entry.hours) : undefined,
    }))

  const seen = new Set<string>()
  const unique = normalized.filter(entry => {
    if (seen.has(entry.userId)) return false
    seen.add(entry.userId)
    return true
  })

  return unique.length > 0 ? unique : undefined
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function getCrewRoleDefaultRate(role?: CrewPayoutRole) {
  return CREW_ROLE_DEFAULT_RATES[role || 'mover'] || CREW_ROLE_DEFAULT_RATES.mover
}

export function computeCrewPayoutAmounts(entry: Pick<CrewPayoutEntry, 'approvedHours' | 'hourlyRate' | 'reimbursementAmount'>) {
  const approvedHours = Number(entry.approvedHours || 0)
  const hourlyRate = Number(entry.hourlyRate || 0)
  const reimbursementAmount = Number(entry.reimbursementAmount || 0)
  const laborPay = roundCurrency(Math.max(0, approvedHours) * Math.max(0, hourlyRate))
  const totalPay = roundCurrency(laborPay + Math.max(0, reimbursementAmount))
  return { laborPay, totalPay }
}

export function normalizeCrewPayouts(entries?: CrewPayoutEntry[]) {
  const seen = new Set<string>()
  const normalized = (entries || []).reduce<CrewPayoutEntry[]>((list, entry) => {
    const id = normalizeOptionalText(entry.id)
    const workerName = normalizeOptionalText(entry.workerName)
    if (!id || !workerName) return list
    const role = entry.role || 'mover'
    const hourlyRate = Number(entry.hourlyRate || getCrewRoleDefaultRate(role))
    const approvedHours = Number(entry.approvedHours || 0)
    const reimbursementAmount = Number(entry.reimbursementAmount || 0)
    const { laborPay } = computeCrewPayoutAmounts({
      approvedHours,
      hourlyRate,
      reimbursementAmount,
    })

    const normalizedEntry: CrewPayoutEntry = {
      id,
      userId: normalizeOptionalText(entry.userId),
      workerName,
      workerEmail: normalizeOptionalText(entry.workerEmail),
      workerPhone: normalizeOptionalText(entry.workerPhone),
      role,
      hourlyRate: roundCurrency(hourlyRate),
      approvedHours: roundCurrency(approvedHours),
      laborPay,
      reimbursementAmount: reimbursementAmount > 0 ? roundCurrency(reimbursementAmount) : undefined,
      reimbursementNote: normalizeOptionalText(entry.reimbursementNote),
      receiptReference: normalizeOptionalText(entry.receiptReference),
      paymentMethod: entry.paymentMethod || 'interac',
      payoutDestination: normalizeOptionalText(entry.payoutDestination),
      payoutStatus: entry.payoutStatus || 'submitted',
      dispatchStatus: entry.dispatchStatus || 'pending',
      dispatchToken: normalizeOptionalText(entry.dispatchToken),
      dispatchSentAt: normalizeOptionalText(entry.dispatchSentAt),
      dispatchConfirmedAt: normalizeOptionalText(entry.dispatchConfirmedAt),
      dispatchDeclinedAt: normalizeOptionalText(entry.dispatchDeclinedAt),
      submittedAt: normalizeOptionalText(entry.submittedAt) || new Date().toISOString(),
      approvedAt: normalizeOptionalText(entry.approvedAt),
      approvedBy: normalizeOptionalText(entry.approvedBy),
      paidAt: normalizeOptionalText(entry.paidAt),
      paidBy: normalizeOptionalText(entry.paidBy),
      financeNote: normalizeOptionalText(entry.financeNote),
      financeCostId: normalizeOptionalText(entry.financeCostId),
      createdAt: normalizeOptionalText(entry.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    if (seen.has(normalizedEntry.id)) return list
    seen.add(normalizedEntry.id)
    list.push(normalizedEntry)
    return list
  }, [])

  return normalized.length > 0 ? normalized : undefined
}

export function deriveOpsChecklist(
  lead: Pick<CRMLead, 'assignedCrew' | 'crewPayouts' | 'originAccess' | 'destAccess' | 'parkingNotes' | 'opsChecklist' | 'truckReservationStatus'>
): OpsChecklist {
  const existing = lead.opsChecklist || {}
  return {
    crewAssigned: (lead.assignedCrew?.length ?? 0) > 0 || (lead.crewPayouts?.some(entry => !!entry.workerName) ?? false),
    truckReserved: isTruckReservationComplete(lead.truckReservationStatus),
    accessConfirmed: existing.accessConfirmed ?? Boolean(lead.originAccess || lead.destAccess),
    parkingConfirmed: existing.parkingConfirmed ?? Boolean(lead.parkingNotes),
    toolsReady: existing.toolsReady ?? false,
    jobPacketReady: existing.jobPacketReady ?? false,
    finalWalkthroughComplete: existing.finalWalkthroughComplete ?? false,
  }
}

export function countCompletedOpsChecklist(checklist?: OpsChecklist) {
  const values = Object.values(checklist || {})
  return values.filter(Boolean).length
}
