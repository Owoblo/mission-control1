import { TRUCK_RESERVATION_STATUS_LABELS } from '@/lib/operations'
import { formatDate, formatDateTime, formatMoney, getLeadAssignedRepName, normalizeFollowUp, uid } from '@/lib/sales'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { saveFollowUpLog } from '@/lib/server/sales-repository'
import type { CRMLead, CRMQuote, FollowUpLog } from '@/lib/types'

export const LEAD_ARCHIVED_NOTE = '__system__:lead_archived'
export const LEAD_RESTORED_NOTE = '__system__:lead_restored'

const ACCEPTED_QUOTE_LOCKED_FIELDS: Array<{ key: keyof CRMQuote; label: string }> = [
  { key: 'status', label: 'status' },
  { key: 'moveDate', label: 'move date' },
  { key: 'moveType', label: 'move type' },
  { key: 'quoteType', label: 'quote type' },
  { key: 'originAddress', label: 'origin address' },
  { key: 'originCity', label: 'origin city' },
  { key: 'destCity', label: 'destination city' },
  { key: 'crewSize', label: 'crew size' },
  { key: 'estimatedHours', label: 'estimated hours' },
  { key: 'truckCount', label: 'truck count' },
  { key: 'estimatedWeightLbs', label: 'estimated weight' },
  { key: 'longDistanceDistanceKm', label: 'distance' },
  { key: 'longDistanceTruckCost', label: 'truck cost' },
  { key: 'longDistanceGasCost', label: 'fuel cost' },
  { key: 'longDistanceInsuranceCost', label: 'insurance cost' },
  { key: 'longDistanceMiscCost', label: 'misc cost' },
  { key: 'longDistanceMarkupRate', label: 'markup' },
  { key: 'validDays', label: 'validity window' },
  { key: 'lineItems', label: 'line items' },
  { key: 'discountAmount', label: 'discount amount' },
  { key: 'discountLabel', label: 'discount label' },
  { key: 'subtotal', label: 'subtotal' },
  { key: 'hst', label: 'HST' },
  { key: 'total', label: 'total price' },
  { key: 'deposit', label: 'deposit' },
  { key: 'balance', label: 'balance' },
  { key: 'moveDescription', label: 'move description' },
]

export type BookedJobFieldDiff = {
  label: string
  before: string
  after: string
  customerFacing?: boolean
}

export type QuoteFieldDiff = {
  label: string
  before: string
  after: string
}

function buildLog(leadId: string, type: FollowUpLog['type'], notes: string): FollowUpLog {
  const now = new Date().toISOString()
  return normalizeFollowUp({
    id: uid('fu'),
    leadId,
    type,
    date: now,
    createdAt: now,
    notes,
  })
}

function buildQuoteLog(quote: CRMQuote, notes: string): FollowUpLog {
  const now = new Date().toISOString()
  return normalizeFollowUp({
    id: uid('fu'),
    leadId: quote.leadId,
    quoteId: quote.id,
    type: 'note',
    date: now,
    createdAt: now,
    notes,
  })
}

function buildScopedLog(leadId: string, notes: string, options?: { quoteId?: string }) {
  const now = new Date().toISOString()
  return normalizeFollowUp({
    id: uid('fu'),
    leadId,
    quoteId: options?.quoteId,
    type: 'note',
    date: now,
    createdAt: now,
    notes,
  })
}

function hasOwn<T extends object>(source: T, key: keyof any) {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function isAcceptedOrBookedQuote(current: CRMQuote, lead?: CRMLead | null) {
  return current.status === 'accepted' || current.status === 'invoiced' || !!current.acceptedAt || lead?.stage === 'booked'
}

function comparableValue(value: unknown) {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string') return value.trim()
  if (value == null) return null
  return value
}

function valuesDiffer(left: unknown, right: unknown) {
  return comparableValue(left) !== comparableValue(right)
}

function formatAuditDate(value?: string) {
  return value ? formatDate(value) : 'TBD'
}

function formatAuditDateTime(value?: string) {
  return value ? formatDateTime(value) : 'Not recorded'
}

function formatRoute(address?: string, city?: string) {
  return [address, city].filter(Boolean).join(', ').trim() || 'TBD'
}

function formatInventorySnapshot(lead: CRMLead) {
  const itemCount = lead.inventory?.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0) || lead.totalItems || 0
  const parts = [
    itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : '',
    lead.totalCubicFeet ? `${Math.round(lead.totalCubicFeet)} cu ft` : '',
    lead.totalWeightLbs ? `${Math.round(lead.totalWeightLbs)} lbs` : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'Not recorded'
}

function formatDepositSnapshot(lead: CRMLead) {
  if (!lead.depositAmount && !lead.depositMethod && !lead.paymentStatus) {
    return 'Not recorded'
  }

  const parts = [
    lead.depositAmount ? formatMoney(lead.depositAmount) : '',
    lead.depositMethod || '',
    lead.paymentStatus || '',
  ].filter(Boolean)

  return parts.join(' / ')
}

function sameStringArray(left?: string[], right?: string[]) {
  const leftSorted = [...(left || [])].sort()
  const rightSorted = [...(right || [])].sort()
  return JSON.stringify(leftSorted) === JSON.stringify(rightSorted)
}

function formatCrewHoursSnapshot(lead: CRMLead) {
  const entries = (lead.crewHours || [])
    .filter(entry => entry.userId)
    .map(entry => `${entry.name || entry.userId.slice(-4)}:${Number(entry.hours || 0) || 0}h`)

  return entries.join(', ') || 'Not recorded'
}

function formatCrewPayoutSnapshot(lead: CRMLead) {
  const entries = (lead.crewPayouts || [])
    .filter(entry => entry.workerName)
    .map(entry => `${entry.workerName}:${Number(entry.approvedHours || 0) || 0}h/${Number(entry.hourlyRate || 0) || 0}`)

  return entries.join(', ') || 'Not recorded'
}

function formatQuoteStatus(status?: CRMQuote['status']) {
  return status ? status.replace(/_/g, ' ') : 'unknown'
}

function formatAuditText(value?: string) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'blank'
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized
}

function formatQuoteLineItemsSnapshot(quote: CRMQuote) {
  const items = quote.lineItems || []
  const count = items.length
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return `${count} item${count === 1 ? '' : 's'} / ${formatMoney(subtotal)}`
}

const QUOTE_AUDIT_FIELDS: Array<{
  label: string
  getValue: (quote: CRMQuote) => unknown
  format: (value: unknown, quote: CRMQuote) => string
}> = [
  { label: 'Status', getValue: quote => quote.status, format: value => formatQuoteStatus(value as CRMQuote['status']) },
  { label: 'Move date', getValue: quote => quote.moveDate, format: value => formatAuditDate(value as string | undefined) },
  { label: 'Move type', getValue: quote => quote.moveType, format: value => formatAuditText(value as string | undefined) },
  { label: 'Quote type', getValue: quote => quote.quoteType, format: value => formatAuditText(value as string | undefined) },
  { label: 'Origin address', getValue: quote => quote.originAddress, format: value => formatAuditText(value as string | undefined) },
  { label: 'Origin city', getValue: quote => quote.originCity, format: value => formatAuditText(value as string | undefined) },
  { label: 'Destination city', getValue: quote => quote.destCity, format: value => formatAuditText(value as string | undefined) },
  { label: 'Crew size', getValue: quote => quote.crewSize, format: value => `${Number(value || 0) || 0}` },
  { label: 'Estimated hours', getValue: quote => quote.estimatedHours, format: value => `${Number(value || 0) || 0}` },
  { label: 'Truck count', getValue: quote => quote.truckCount, format: value => `${Number(value || 0) || 0}` },
  { label: 'Estimated weight', getValue: quote => quote.estimatedWeightLbs, format: value => value ? `${Math.round(Number(value))} lbs` : 'Not set' },
  { label: 'Distance', getValue: quote => quote.longDistanceDistanceKm, format: value => value ? `${Math.round(Number(value))} km` : 'Not set' },
  { label: 'Truck cost', getValue: quote => quote.longDistanceTruckCost, format: value => formatMoney(Number(value || 0)) },
  { label: 'Fuel cost', getValue: quote => quote.longDistanceGasCost, format: value => formatMoney(Number(value || 0)) },
  { label: 'Insurance cost', getValue: quote => quote.longDistanceInsuranceCost, format: value => formatMoney(Number(value || 0)) },
  { label: 'Misc cost', getValue: quote => quote.longDistanceMiscCost, format: value => formatMoney(Number(value || 0)) },
  { label: 'Markup rate', getValue: quote => quote.longDistanceMarkupRate, format: value => `${Number(value || 0) || 0}%` },
  { label: 'Valid days', getValue: quote => quote.validDays, format: value => `${Number(value || 0) || 0}` },
  { label: 'Line items', getValue: quote => formatQuoteLineItemsSnapshot(quote), format: value => String(value || '0 items') },
  { label: 'Discount amount', getValue: quote => quote.discountAmount, format: value => formatMoney(Number(value || 0)) },
  { label: 'Discount label', getValue: quote => quote.discountLabel, format: value => formatAuditText(value as string | undefined) },
  { label: 'Subtotal', getValue: quote => quote.subtotal, format: value => formatMoney(Number(value || 0)) },
  { label: 'HST', getValue: quote => quote.hst, format: value => formatMoney(Number(value || 0)) },
  { label: 'Total', getValue: quote => quote.total, format: value => formatMoney(Number(value || 0)) },
  { label: 'Deposit', getValue: quote => quote.deposit, format: value => formatMoney(Number(value || 0)) },
  { label: 'Balance', getValue: quote => quote.balance, format: value => formatMoney(Number(value || 0)) },
  { label: 'Move description', getValue: quote => quote.moveDescription, format: value => formatAuditText(value as string | undefined) },
  { label: 'Internal notes', getValue: quote => quote.internalNotes, format: value => formatAuditText(value as string | undefined) },
  { label: 'Direct price override', getValue: quote => quote.priceOverrideTotal, format: value => value === undefined ? 'Not set' : formatMoney(Number(value || 0)) },
  { label: 'Override reason', getValue: quote => quote.priceOverrideReason, format: value => formatAuditText(value as string | undefined) },
  { label: 'Sent at', getValue: quote => quote.sentAt, format: value => formatAuditDateTime(value as string | undefined) },
  { label: 'Accepted at', getValue: quote => quote.acceptedAt, format: value => formatAuditDateTime(value as string | undefined) },
]

function formatQuoteActor(actorName?: string | null) {
  const trimmed = actorName?.trim()
  return trimmed || 'System'
}

type PaymentAuditAction = 'card_saved' | 'deposit_charged' | 'deposit_charge_attempt' | 'balance_charged' | 'invoice_sent'

export async function recordLeadPaymentAudit(input: {
  leadId: string
  quoteId?: string
  actorName?: string | null
  action: PaymentAuditAction
  amount?: number | null
  cardBrand?: string | null
  cardLast4?: string | null
  note?: string | null
}) {
  const actor = formatQuoteActor(input.actorName)
  const amountText = typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
    ? formatMoney(input.amount)
    : ''
  const cardText = [input.cardBrand, input.cardLast4 ? `ending ${input.cardLast4}` : '']
    .filter(Boolean)
    .join(' ')

  const normalizedNote = (input.note || '').trim().replace(/[.]+$/g, '')
  const detail = [amountText, cardText, normalizedNote].filter(Boolean).join(' · ')
  const noteSuffix = detail ? ` ${detail}.` : '.'

  const note = input.action === 'card_saved'
    ? `${actor} saved a customer card on file through the CRM.${detail ? ` ${detail}.` : ''}`
    : input.action === 'deposit_charged'
      ? `${actor} charged the deposit through the CRM.${noteSuffix}`
      : input.action === 'deposit_charge_attempt'
        ? `${actor} attempted a deposit card charge through the CRM.${noteSuffix}`
        : input.action === 'balance_charged'
          ? `${actor} charged the remaining balance through the CRM.${noteSuffix}`
          : `${actor} sent a Stripe invoice from the CRM.${noteSuffix}`

  await persistLogs([buildScopedLog(input.leadId, note, { quoteId: input.quoteId })])
}

export function getQuoteFieldDiffs(previous: CRMQuote, next: CRMQuote): QuoteFieldDiff[] {
  return QUOTE_AUDIT_FIELDS
    .filter(field => valuesDiffer(field.getValue(previous), field.getValue(next)))
    .map(field => ({
      label: field.label,
      before: field.format(field.getValue(previous), previous),
      after: field.format(field.getValue(next), next),
    }))
}

export function getAcceptedQuoteLockedFieldChanges(current: CRMQuote, updates: Partial<CRMQuote>, lead?: CRMLead | null) {
  if (!isAcceptedOrBookedQuote(current, lead)) {
    return []
  }

  return ACCEPTED_QUOTE_LOCKED_FIELDS
    .filter(({ key }) => hasOwn(updates, key) && valuesDiffer(current[key], updates[key]))
    .map(({ label }) => label)
}

export async function recordQuoteCreatedAudit(quote: CRMQuote, actorName?: string | null) {
  const actor = formatQuoteActor(actorName)
  await persistLogs([
    buildQuoteLog(
      quote,
      `${actor} created quote ${quote.number} as ${formatQuoteStatus(quote.status)} for ${formatMoney(quote.total)}.`
    ),
  ])
}

export async function recordQuoteUpdatedAudit(previous: CRMQuote, next: CRMQuote, actorName?: string | null) {
  const diffs = getQuoteFieldDiffs(previous, next)
  if (diffs.length === 0) {
    return
  }

  const actor = formatQuoteActor(actorName)
  const visibleDiffs = diffs.slice(0, 8)
  const summary = visibleDiffs
    .map(diff => `${diff.label}: ${diff.before} -> ${diff.after}`)
    .join(' | ')
  const overflow = diffs.length > visibleDiffs.length
    ? ` | +${diffs.length - visibleDiffs.length} more change${diffs.length - visibleDiffs.length === 1 ? '' : 's'}`
    : ''

  await persistLogs([
    buildQuoteLog(
      next,
      `${actor} updated quote ${next.number}. ${summary}${overflow}`
    ),
  ])
}

export function getBookedJobFieldDiffs(previous: CRMLead, next: CRMLead): BookedJobFieldDiff[] {
  if (previous.stage !== 'booked' && next.stage !== 'booked') {
    return []
  }

  const diffs: BookedJobFieldDiff[] = []

  if (valuesDiffer(previous.moveDate, next.moveDate)) {
    diffs.push({
      label: 'Move date',
      before: formatAuditDate(previous.moveDate),
      after: formatAuditDate(next.moveDate),
      customerFacing: true,
    })
  }

  const previousOrigin = formatRoute(previous.originAddress, previous.originCity)
  const nextOrigin = formatRoute(next.originAddress, next.originCity)
  if (previousOrigin !== nextOrigin) {
    diffs.push({
      label: 'Origin',
      before: previousOrigin,
      after: nextOrigin,
      customerFacing: true,
    })
  }

  const previousDestination = formatRoute(previous.destAddress, previous.destCity)
  const nextDestination = formatRoute(next.destAddress, next.destCity)
  if (previousDestination !== nextDestination) {
    diffs.push({
      label: 'Destination',
      before: previousDestination,
      after: nextDestination,
      customerFacing: true,
    })
  }

  const previousInventory = formatInventorySnapshot(previous)
  const nextInventory = formatInventorySnapshot(next)
  if (previousInventory !== nextInventory) {
    diffs.push({
      label: 'Inventory scope',
      before: previousInventory,
      after: nextInventory,
    })
  }

  const previousDeposit = formatDepositSnapshot(previous)
  const nextDeposit = formatDepositSnapshot(next)
  if (previousDeposit !== nextDeposit) {
    diffs.push({
      label: 'Deposit status',
      before: previousDeposit,
      after: nextDeposit,
    })
  }

  return diffs
}

export async function sendBookedJobChangeNotice(
  next: CRMLead,
  quote: CRMQuote | null,
  diffs: BookedJobFieldDiff[],
  actor?: { actorName?: string | null; actorUserId?: string | null }
) {
  const customerFacingDiffs = diffs.filter(diff => diff.customerFacing)
  if (customerFacingDiffs.length === 0) {
    return
  }

  const firstName = (next.name || 'there').split(' ')[0]
  const quoteLabel = quote?.number ? `Quote ${quote.number}` : 'your booking'
  const bulletLines = customerFacingDiffs.map(diff => `- ${diff.label}: ${diff.after}`)
  const emailBody = [
    `Hi ${firstName},`,
    '',
    `We updated the move details on ${quoteLabel}.`,
    '',
    ...bulletLines,
    '',
    `If anything looks off, reply to this message or call Saturn Star Moving at 226-773-2993.`,
  ].join('\n')
  const smsBody = `Hi ${firstName}, we updated your Saturn Star booking: ${customerFacingDiffs.map(diff => `${diff.label} ${diff.after}`).join(' · ')}. Reply here or call 226-773-2993 if anything looks off.`

  if (next.email) {
    await sendSalesMessage({
      channel: 'email',
      to: next.email,
      subject: `${quoteLabel} updated`,
      body: emailBody,
      htmlBody: emailBody.replace(/\n/g, '<br>'),
      leadId: next.id,
      quoteId: quote?.id,
      actor: 'human',
      actorName: actor?.actorName || undefined,
      actorUserId: actor?.actorUserId || undefined,
      notes: `Booked-job change notice emailed to ${next.email}.`,
    })
    return
  }

  if (next.phone) {
    await sendSalesMessage({
      channel: 'sms',
      to: next.phone,
      body: smsBody,
      leadId: next.id,
      quoteId: quote?.id,
      actor: 'human',
      actorName: actor?.actorName || undefined,
      actorUserId: actor?.actorUserId || undefined,
      notes: `Booked-job change notice texted to ${next.phone}.`,
    })
  }
}

async function persistLogs(logs: FollowUpLog[]) {
  for (const log of logs) {
    try {
      await saveFollowUpLog(log)
    } catch (error) {
      console.error('Failed to persist sales audit log', {
        log,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export async function recordLeadCreatedAudit(lead: CRMLead) {
  const logs = [buildLog(lead.id, 'note', 'Lead created in sales CRM.')]
  const assignedRep = getLeadAssignedRepName(lead)
  if (assignedRep) {
    logs.push(buildLog(lead.id, 'note', `Lead owner assigned to ${assignedRep}.`))
  }
  await persistLogs(logs)
}

export async function recordLeadArchivedAudit(leadId: string) {
  await persistLogs([buildLog(leadId, 'note', LEAD_ARCHIVED_NOTE)])
}

export async function recordLeadRestoredAudit(leadId: string) {
  await persistLogs([buildLog(leadId, 'note', LEAD_RESTORED_NOTE)])
}

export async function recordLeadUpdateAudit(previous: CRMLead, next: CRMLead) {
  const logs: FollowUpLog[] = []
  const previousAssignedRep = getLeadAssignedRepName(previous)
  const nextAssignedRep = getLeadAssignedRepName(next)
  const previousAssignedRepUserId = previous.assignedRepUserId || ''
  const nextAssignedRepUserId = next.assignedRepUserId || ''

  if (previous.stage !== next.stage) {
    logs.push(buildLog(next.id, 'note', `Stage updated from ${previous.stage} to ${next.stage}.`))
  }

  if (previousAssignedRep !== nextAssignedRep || previousAssignedRepUserId !== nextAssignedRepUserId) {
    if (!previousAssignedRep && nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead owner assigned to ${nextAssignedRep}.`))
    } else if (previousAssignedRep && nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead reassigned from ${previousAssignedRep} to ${nextAssignedRep}.`))
    } else if (previousAssignedRep && !nextAssignedRep) {
      logs.push(buildLog(next.id, 'note', `Lead owner cleared from ${previousAssignedRep}.`))
    }
  }

  if ((previous.followUpDate || '') !== (next.followUpDate || '') && next.followUpDate) {
    logs.push(buildLog(next.id, 'note', `Follow-up scheduled for ${next.followUpDate}.`))
  }

  if (!sameStringArray(previous.assignedCrew, next.assignedCrew)) {
    const crewCount = next.assignedCrew?.length || 0
    logs.push(buildLog(next.id, 'note', crewCount > 0 ? `Crew assignment updated (${crewCount} assigned).` : 'Crew assignment cleared.'))
  }

  const hasSentInitialEstimate = !!(previous.quoteId || next.quoteId || previous.quoteIds?.length || next.quoteIds?.length)
  if (hasSentInitialEstimate && (previous.inventory?.length || 0) !== (next.inventory?.length || 0) && (next.inventory?.length || 0) > 0) {
    logs.push(buildLog(next.id, 'note', `Inventory updated with ${next.inventory?.length || 0} item${next.inventory?.length === 1 ? '' : 's'}.`))
  }

  const bookedJobDiffs = getBookedJobFieldDiffs(previous, next)
  if (bookedJobDiffs.length > 0) {
    const summary = bookedJobDiffs
      .map(diff => `${diff.label}: ${diff.before} -> ${diff.after}`)
      .join(' | ')
    logs.push(buildLog(next.id, 'note', `Booked-job change notice: ${summary}`))
  }

  if ((previous.truckReservationStatus || '') !== (next.truckReservationStatus || '')) {
    const label = next.truckReservationStatus ? TRUCK_RESERVATION_STATUS_LABELS[next.truckReservationStatus] : 'Unknown'
    logs.push(buildLog(next.id, 'note', `Truck reservation status updated to ${label}.`))
  }

  if (
    previous.truckPickupLocation !== next.truckPickupLocation ||
    previous.truckPickupTime !== next.truckPickupTime ||
    previous.truckReturnLocation !== next.truckReturnLocation ||
    previous.truckReservationNumber !== next.truckReservationNumber
  ) {
    const parts = [
      next.truckPickupLocation ? `pickup ${next.truckPickupLocation}` : '',
      next.truckPickupTime ? `at ${next.truckPickupTime}` : '',
      next.truckReturnLocation ? `return ${next.truckReturnLocation}` : '',
      next.truckReservationNumber ? `ref ${next.truckReservationNumber}` : '',
    ].filter(Boolean)
    logs.push(buildLog(next.id, 'note', `Truck reservation details updated${parts.length ? `: ${parts.join(' | ')}` : '.'}`))
  }

  const previousCrewHours = formatCrewHoursSnapshot(previous)
  const nextCrewHours = formatCrewHoursSnapshot(next)
  if (previousCrewHours !== nextCrewHours) {
    logs.push(buildLog(next.id, 'note', `Crew hours updated: ${nextCrewHours}`))
  }

  const previousCrewPayouts = formatCrewPayoutSnapshot(previous)
  const nextCrewPayouts = formatCrewPayoutSnapshot(next)
  if (previousCrewPayouts !== nextCrewPayouts) {
    logs.push(buildLog(next.id, 'note', `Crew payout details updated: ${nextCrewPayouts}`))
  }

  if (logs.length > 0) {
    await persistLogs(logs)
  }
}
