import { deriveOpsChecklist, getQuotedTruckCount, isTruckReservationComplete } from './operations'
import type { CRMLead, CRMQuote } from './types'

export type OperatingStage =
  | 'lead'
  | 'qualified'
  | 'estimate'
  | 'quote'
  | 'booked'
  | 'confirmed'
  | 'prepared'
  | 'dispatched'
  | 'in_progress'
  | 'completed'
  | 'paid'
  | 'reviewed'
  | 'closed'

export const OPERATING_STAGE_META: Record<OperatingStage, { label: string; environment: string }> = {
  lead: { label: 'Lead', environment: 'Intake' },
  qualified: { label: 'Qualified', environment: 'Sales' },
  estimate: { label: 'Estimate', environment: 'Sales' },
  quote: { label: 'Quote', environment: 'Sales' },
  booked: { label: 'Booked', environment: 'Operations' },
  confirmed: { label: 'Confirmed', environment: 'Operations' },
  prepared: { label: 'Prepared', environment: 'Operations' },
  dispatched: { label: 'Dispatched', environment: 'Live execution' },
  in_progress: { label: 'In progress', environment: 'Live execution' },
  completed: { label: 'Completed', environment: 'Completion & care' },
  paid: { label: 'Paid', environment: 'Completion & care' },
  reviewed: { label: 'Reviewed', environment: 'Completion & care' },
  closed: { label: 'Closed', environment: 'Management' },
}

export type ReadinessDimension = {
  key: 'customer' | 'financial' | 'crew' | 'equipment' | 'operational'
  label: string
  complete: number
  total: number
  missing: string[]
}

export type JobReadiness = {
  status: 'not_ready' | 'at_risk' | 'ready_with_exceptions' | 'fully_ready'
  label: 'Not ready' | 'At risk' | 'Ready with exceptions' | 'Fully ready'
  completed: number
  total: number
  percent: number
  dimensions: ReadinessDimension[]
}

export type OperatingException = {
  id: string
  leadId: string
  customer: string
  branch?: string
  severity: 'attention' | 'urgent'
  environment: 'Intake' | 'Sales' | 'Operations' | 'Live execution' | 'Completion & care'
  title: string
  detail: string
  action: string
  href: string
}

function hasDeposit(lead: CRMLead, quote?: CRMQuote | null) {
  return lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || Boolean(quote?.depositPaidAt)
}

function isPaid(lead: CRMLead, quote?: CRMQuote | null) {
  return lead.paymentStatus === 'paid_in_full' || Boolean(quote?.balancePaidAt) || Number(quote?.balance || 0) <= 0
}

function executionTimestamp(lead: CRMLead, phase: string) {
  return lead.moveExecutionLog?.entries?.find(entry => entry.phase === phase)?.timestamp
}

function hasAssignedCrew(lead: CRMLead) {
  return (lead.assignedCrew?.length || 0) > 0 || (lead.crewPayouts?.some(entry => Boolean(entry.workerName)) ?? false)
}

function hasConfirmedCrew(lead: CRMLead) {
  const roster = (lead.crewPayouts || []).filter(entry => entry.workerName)
  return roster.length > 0 && roster.every(entry => entry.dispatchStatus === 'confirmed')
}

function requiresTruck(lead: CRMLead, quote?: CRMQuote | null) {
  return Boolean(getQuotedTruckCount(lead, quote))
}

function moveDate(lead: CRMLead, quote?: CRMQuote | null) {
  return lead.moveDate || quote?.moveDate
}

function daysFromToday(value?: string) {
  if (!value) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const target = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export function deriveOperatingStage(lead: CRMLead, quote?: CRMQuote | null): OperatingStage {
  if (lead.stage === 'lost') return 'closed'
  if (lead.reviewCompletedAt) return 'reviewed'
  if (lead.stage === 'completed' || lead.stage === 'customer_success') {
    return isPaid(lead, quote) ? 'paid' : 'completed'
  }
  if (executionTimestamp(lead, 'return_yard') || executionTimestamp(lead, 'unload_complete')) return 'completed'
  if (executionTimestamp(lead, 'arrive_origin') || executionTimestamp(lead, 'crew_depart_yard')) return 'in_progress'
  if (hasConfirmedCrew(lead)) return 'dispatched'
  if (lead.stage === 'booked') {
    const readiness = deriveJobReadiness(lead, quote)
    if (readiness.status === 'fully_ready') return 'prepared'
    if (hasDeposit(lead, quote)) return 'confirmed'
    return 'booked'
  }
  if (quote?.sentAt || lead.stage === 'quoted' || lead.stage === 'tentative') return 'quote'
  if (lead.stage === 'pricing' || lead.stage === 'estimate_completed') return 'estimate'
  if (lead.stage === 'estimate_scheduled') return 'estimate'
  if (lead.stage === 'contacted' || lead.stage === 'nurture') return 'qualified'
  return 'lead'
}

function dimension(key: ReadinessDimension['key'], label: string, checks: Array<[boolean, string]>): ReadinessDimension {
  const missing = checks.filter(([complete]) => !complete).map(([, text]) => text)
  return { key, label, complete: checks.length - missing.length, total: checks.length, missing }
}

export function deriveJobReadiness(lead: CRMLead, quote?: CRMQuote | null): JobReadiness {
  const checklist = deriveOpsChecklist(lead)
  const truckNeeded = requiresTruck(lead, quote)
  const dimensions = [
    dimension('customer', 'Customer', [
      [Boolean(moveDate(lead, quote)), 'Move date not confirmed'],
      [Boolean(lead.originAddress || quote?.originAddress), 'Origin address missing'],
      [Boolean(lead.destAddress || quote?.destAddress), 'Destination address missing'],
      [Boolean(checklist.accessConfirmed), 'Access not confirmed'],
      [Boolean(lead.phone || lead.email), 'Customer contact missing'],
    ]),
    dimension('financial', 'Financial', [
      [Boolean(quote?.acceptedAt || lead.stage === 'booked'), 'Quote not accepted'],
      [hasDeposit(lead, quote), 'Deposit unpaid'],
      [Boolean(quote?.paymentTerms || quote?.deposit !== undefined), 'Payment terms not recorded'],
    ]),
    dimension('crew', 'Crew', [
      [hasAssignedCrew(lead), 'Crew not assigned'],
      [hasConfirmedCrew(lead), 'Crew availability not confirmed'],
    ]),
    dimension('equipment', 'Equipment', [
      [!truckNeeded || isTruckReservationComplete(lead.truckReservationStatus), 'Truck not reserved'],
      [Boolean(checklist.toolsReady), 'Equipment not confirmed'],
    ]),
    dimension('operational', 'Operational', [
      [Boolean(checklist.parkingConfirmed), 'Parking not confirmed'],
      [Boolean(checklist.jobPacketReady), 'Crew briefing not ready'],
      [Boolean(lead.originCity || quote?.originCity), 'Origin market missing'],
    ]),
  ]
  const completed = dimensions.reduce((sum, item) => sum + item.complete, 0)
  const total = dimensions.reduce((sum, item) => sum + item.total, 0)
  const percent = total ? Math.round((completed / total) * 100) : 0
  const days = daysFromToday(moveDate(lead, quote))
  const missing = total - completed
  const urgentWindow = days !== null && days <= 1
  const status = missing === 0
    ? 'fully_ready'
    : urgentWindow && missing >= 3
      ? 'at_risk'
      : missing >= 6
        ? 'not_ready'
        : 'ready_with_exceptions'
  const labels: Record<JobReadiness['status'], JobReadiness['label']> = {
    not_ready: 'Not ready',
    at_risk: 'At risk',
    ready_with_exceptions: 'Ready with exceptions',
    fully_ready: 'Fully ready',
  }
  return { status, label: labels[status], completed, total, percent, dimensions }
}

export function deriveOperatingExceptions(lead: CRMLead, quote?: CRMQuote | null): OperatingException[] {
  const items: OperatingException[] = []
  const href = `/sales/leads/${lead.id}`
  const add = (key: string, exception: Omit<OperatingException, 'id' | 'leadId' | 'customer' | 'branch' | 'href'>) => items.push({
    id: `${lead.id}:${key}`,
    leadId: lead.id,
    customer: lead.name,
    branch: lead.branch,
    href,
    ...exception,
  })
  const activeSales = !['booked', 'completed', 'customer_success', 'lost'].includes(lead.stage)
  const now = Date.now()
  for (const promise of (lead.promises || []).filter(item => item.status === 'open')) {
    const due = new Date(promise.dueAt).getTime()
    if (Number.isFinite(due) && due <= now + 24 * 60 * 60 * 1000) add(`promise:${promise.id}`, {
      severity: due < now ? 'urgent' : 'attention',
      environment: activeSales ? 'Sales' : lead.stage === 'booked' ? 'Operations' : 'Completion & care',
      title: due < now ? 'Promise overdue' : 'Promise due soon',
      detail: `${promise.action} · ${promise.reason}`,
      action: 'Complete or reschedule promise',
    })
  }
  if (activeSales && !lead.assignedRepUserId && !lead.assignedRepName && !lead.assignedRep) add('owner', { severity: 'urgent', environment: 'Intake', title: 'No owner assigned', detail: 'Incoming demand has no accountable person.', action: 'Assign an owner' })
  if (activeSales && ['estimate_completed', 'pricing'].includes(lead.stage) && !quote?.sentAt) add('quote', { severity: 'attention', environment: 'Sales', title: 'Quote has not been sent', detail: 'The estimate is far enough along to require a customer decision.', action: 'Finish and send quote' })
  if (activeSales && lead.lastInboundAt && (!lead.lastHumanOutboundAt || lead.lastInboundAt > lead.lastHumanOutboundAt)) add('reply', { severity: 'urgent', environment: 'Sales', title: 'Customer is waiting', detail: 'The latest inbound message has no later human response.', action: 'Respond now' })
  if (lead.stage === 'booked') {
    const readiness = deriveJobReadiness(lead, quote)
    const days = daysFromToday(moveDate(lead, quote))
    if (!hasDeposit(lead, quote)) add('deposit', { severity: days !== null && days <= 2 ? 'urgent' : 'attention', environment: 'Operations', title: 'Booked without deposit', detail: 'Financial confirmation is still incomplete.', action: 'Resolve deposit' })
    for (const item of readiness.dimensions.flatMap(item => item.missing).slice(0, 4)) add(`readiness:${item}`, { severity: days !== null && days <= 1 ? 'urgent' : 'attention', environment: 'Operations', title: item, detail: `${readiness.label} · ${readiness.percent}% complete`, action: 'Complete job preparation' })
  }
  const openIssues = lead.moveExecutionLog?.issues?.filter(issue => issue.severity === 'high' || issue.severity === 'medium') || []
  for (const issue of openIssues) add(`issue:${issue.id}`, { severity: issue.severity === 'high' ? 'urgent' : 'attention', environment: 'Live execution', title: `${issue.category.replaceAll('_', ' ')} issue`, detail: issue.note, action: 'Review live issue' })
  if ((lead.stage === 'completed' || lead.stage === 'customer_success') && !isPaid(lead, quote)) add('balance', { severity: 'urgent', environment: 'Completion & care', title: 'Completed but unpaid', detail: 'The job is complete and a balance remains open.', action: 'Resolve final payment' })
  if ((lead.stage === 'completed' || lead.stage === 'customer_success') && !lead.reviewSentAt) add('review', { severity: 'attention', environment: 'Completion & care', title: 'Care follow-up not sent', detail: 'The completed job has no recorded review request.', action: 'Complete customer follow-up' })
  return items
}
