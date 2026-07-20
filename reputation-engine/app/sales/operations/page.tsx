'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  computeCrewPayoutAmounts,
  countCompletedOpsChecklist,
  CREW_DISPATCH_STATUS_LABELS,
  CREW_PAYOUT_METHOD_LABELS,
  CREW_PAYOUT_ROLE_LABELS,
  CREW_PAYOUT_STATUS_LABELS,
  CREW_ROLE_DEFAULT_RATES,
  deriveOpsChecklist,
  getCrewRoleDefaultRate,
  getQuotedTruckCount,
  getTruckPlanLabel,
  isTruckReservationComplete,
  TRUCK_RESERVATION_STATUS_LABELS,
  TRUCK_VENDOR_LABELS,
} from '@/lib/operations'
import { deriveAccessComplexityAssessment } from '@/lib/access-intelligence'
import { deriveJobReadiness } from '@/lib/job-spine'
import { buildDefaultMoveExecutionEntries, MOVE_EXECUTION_PHASES } from '@/lib/move-execution'
import { updateSalesLead } from '@/lib/sales-api'
import { formatDate, formatDateTime, formatMoney, uid } from '@/lib/sales'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type {
  CRMLead,
  CRMQuote,
  CrewHoursEntry,
  CrewPayoutEntry,
  CrewDispatchStatus,
  CrewPayoutMethod,
  CrewPayoutRole,
  MoveExecutionIssue,
  MoveExecutionPhase,
  TruckReservationStatus,
  TruckVendor,
} from '@/lib/types'

const BRANCH_LABELS: Record<string, string> = {
  windsor: 'Windsor',
  waterloo: 'Waterloo / KW',
  london: 'London',
  ottawa: 'Ottawa',
}

const BRANCH_COLORS: Record<string, string> = {
  windsor: 'bg-blue-100 text-blue-800',
  waterloo: 'bg-purple-100 text-purple-800',
  london: 'bg-emerald-100 text-emerald-800',
  ottawa: 'bg-red-100 text-red-800',
}

interface CrewMember {
  id: string
  name: string
  role: string
  email?: string
  phone?: string
}

type Job = {
  lead: CRMLead
  quote: CRMQuote | null
}

type DispatchReadinessLevel = 'ready' | 'attention' | 'urgent'
type OperationsFilterKey = 'ready' | 'no_crew' | 'no_truck' | 'deposit_unpaid' | 'tomorrow' | 'needs_confirmation' | 'needs_equipment' | 'needs_briefing'

const OPERATIONS_FILTERS: Array<{ key: OperationsFilterKey; label: string }> = [
  { key: 'ready', label: 'Ready' },
  { key: 'no_crew', label: 'No crew' },
  { key: 'no_truck', label: 'No truck' },
  { key: 'deposit_unpaid', label: 'Deposit unpaid' },
  { key: 'tomorrow', label: 'Tomorrow’s jobs' },
  { key: 'needs_confirmation', label: 'Needs confirmation' },
  { key: 'needs_equipment', label: 'Needs equipment' },
  { key: 'needs_briefing', label: 'Needs briefing' },
]

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function tomorrowISO() {
  const [year, month, day] = todayISO().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function getJobMoveDate(job: Job) {
  return job.lead.moveDate || job.quote?.moveDate
}

function isDepositPaid(job: Job) {
  return (
    job.lead.paymentStatus === 'deposit_received' ||
    job.lead.paymentStatus === 'paid_in_full' ||
    !!job.quote?.depositPaidAt
  )
}

function hasAssignedCrew(job: Job) {
  return (job.lead.assignedCrew?.length ?? 0) > 0
}

function getRequiredDriverCount(job: Job) {
  return Number(getQuotedTruckCount(job.lead, job.quote) || 0)
}

function getRequiredCrewCount(job: Job) {
  return Number(job.quote?.crewSize || job.lead.assignedCrew?.length || 0)
}

function getCrewRoster(job: Job) {
  return (job.lead.crewPayouts || []).filter(entry => entry.workerName)
}

function getAssignedDriverCount(job: Job) {
  return getCrewRoster(job).filter(entry => entry.role === 'driver' || entry.role === 'crew_lead').length
}

function getAssignedMoverCount(job: Job) {
  return getCrewRoster(job).filter(entry => entry.role === 'mover' || entry.role === 'crew_lead' || entry.role === 'driver').length
}

function hasCrewRolePlan(job: Job) {
  const requiredCrew = getRequiredCrewCount(job)
  const requiredDrivers = getRequiredDriverCount(job)
  if (requiredCrew <= 0) return hasAssignedCrew(job) || getCrewRoster(job).length > 0
  return getAssignedMoverCount(job) >= requiredCrew && getAssignedDriverCount(job) >= requiredDrivers
}

function hasCrewConfirmed(job: Job) {
  const roster = getCrewRoster(job)
  if (roster.length === 0) return false
  return roster.every(entry => entry.dispatchStatus === 'confirmed')
}

function requiresTruck(job: Job) {
  return !!getQuotedTruckCount(job.lead, job.quote)
}

function hasTruckAssigned(job: Job) {
  return !requiresTruck(job) || isTruckReservationComplete(job.lead.truckReservationStatus)
}

function hasCustomerConfirmation(job: Job) {
  const checklist = deriveOpsChecklist(job.lead)
  const accessAssessment = deriveAccessComplexityAssessment(job.lead)
  const accessReady = checklist.accessConfirmed || accessAssessment.accessAutoClear
  const parkingReady = checklist.parkingConfirmed || accessAssessment.parkingAutoClear
  return !!(accessReady && parkingReady)
}

function readinessBadgeClasses(level: DispatchReadinessLevel) {
  if (level === 'urgent') return 'bg-rose-100 text-rose-700'
  if (level === 'attention') return 'bg-amber-100 text-amber-800'
  return 'bg-emerald-100 text-emerald-700'
}

function deriveDispatchReadiness(job: Job): { level: DispatchReadinessLevel; label: string; reasons: string[] } {
  const checklist = deriveOpsChecklist(job.lead)
  const moveDate = getJobMoveDate(job)
  const days = daysUntilMove(moveDate)
  const reasons: string[] = []

  if (!moveDate) reasons.push('Move date missing')
  if (!isDepositPaid(job)) reasons.push('Deposit unpaid')
  if (!hasCrewRolePlan(job)) {
    const requiredDrivers = getRequiredDriverCount(job)
    const requiredCrew = getRequiredCrewCount(job)
    reasons.push(requiredDrivers > 0 ? `${requiredDrivers} driver${requiredDrivers === 1 ? '' : 's'} / ${requiredCrew || '?'} crew not fully assigned` : 'Crew not fully assigned')
  }
  if (hasCrewRolePlan(job) && !hasCrewConfirmed(job)) reasons.push('Crew confirmations pending')
  if (requiresTruck(job) && !hasTruckAssigned(job)) reasons.push('Truck reservation missing')
  const accessAssessment = deriveAccessComplexityAssessment(job.lead)
  const accessReady = checklist.accessConfirmed || accessAssessment.accessAutoClear
  const parkingReady = checklist.parkingConfirmed || accessAssessment.parkingAutoClear
  if (!accessReady || !parkingReady) {
    reasons.push(
      accessAssessment.status === 'unknown'
        ? 'Access intelligence missing'
        : `${accessAssessment.label}: ${accessAssessment.extraMinutes} min setup risk`
    )
  }
  if (!checklist.toolsReady) reasons.push('Equipment not confirmed')
  if (!checklist.jobPacketReady) reasons.push('Crew briefing not ready')

  if (reasons.length === 0) return { level: 'ready', label: 'Ready', reasons: ['Dispatch checklist is ready'] }
  const level: DispatchReadinessLevel = days !== null && days <= 1 ? 'urgent' : 'attention'
  return { level, label: level === 'urgent' ? 'Urgent setup' : 'Needs setup', reasons }
}

function matchesOperationsFilter(job: Job, filter: OperationsFilterKey) {
  const checklist = deriveOpsChecklist(job.lead)
  if (filter === 'ready') return deriveDispatchReadiness(job).level === 'ready'
  if (filter === 'no_crew') return !hasCrewRolePlan(job)
  if (filter === 'no_truck') return requiresTruck(job) && !hasTruckAssigned(job)
  if (filter === 'deposit_unpaid') return !isDepositPaid(job)
  if (filter === 'tomorrow') return getJobMoveDate(job) === tomorrowISO()
  if (filter === 'needs_confirmation') return !hasCustomerConfirmation(job)
  if (filter === 'needs_equipment') return !checklist.toolsReady
  if (filter === 'needs_briefing') return !checklist.jobPacketReady
  return true
}

function daysUntilMove(dateStr?: string) {
  if (!dateStr) return null
  const diff = new Date(`${dateStr}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function MoveDateBadge({ dateStr }: { dateStr?: string }) {
  const days = daysUntilMove(dateStr)
  if (!dateStr) return <span className="text-xs text-slate-400">No date set</span>
  const label = days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : days !== null && days < 0 ? `${Math.abs(days)}d ago` : `In ${days}d`
  const color =
    days === 0 ? 'bg-rose-600 text-white' :
    days === 1 ? 'bg-amber-500 text-white' :
    days !== null && days < 0 ? 'bg-slate-200 text-slate-600' :
    days !== null && days <= 7 ? 'bg-emerald-100 text-emerald-800' :
    'bg-slate-100 text-slate-600'

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold text-[#071421]">{formatDate(dateStr)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color}`}>{label}</span>
    </div>
  )
}

function PaymentBadge({ lead }: { lead: CRMLead }) {
  if (lead.paymentStatus === 'paid_in_full') {
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Paid in Full</span>
  }
  if (lead.paymentStatus === 'deposit_received') {
    return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">Deposit Received</span>
  }
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Deposit Pending</span>
}

function formatRouteAddress(address?: string, city?: string) {
  return [address, city].filter(Boolean).join(', ').trim() || city || address || '—'
}

function getJobRoute(job: Job) {
  return {
    origin: formatRouteAddress(job.quote?.originAddress || job.lead.originAddress, job.quote?.originCity || job.lead.originCity),
    destination: formatRouteAddress(job.lead.destAddress, job.quote?.destCity || job.lead.destCity),
  }
}

function truckStatusColor(status?: TruckReservationStatus) {
  switch (status) {
    case 'reserved':
      return 'bg-emerald-100 text-emerald-800'
    case 'booking_in_progress':
      return 'bg-sky-100 text-sky-800'
    case 'issue':
      return 'bg-rose-100 text-rose-800'
    case 'not_needed':
      return 'bg-slate-100 text-slate-600'
    default:
      return 'bg-amber-100 text-amber-800'
  }
}

function TruckReservationBadge({ lead, quote }: { lead: CRMLead; quote?: CRMQuote | null }) {
  const status = lead.truckReservationStatus || (getQuotedTruckCount(lead, quote) ? 'needs_booking' : 'not_needed')
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${truckStatusColor(status)}`}>
      {TRUCK_RESERVATION_STATUS_LABELS[status]}
    </span>
  )
}

function OpsProgressBadge({ lead }: { lead: CRMLead }) {
  const checklist = deriveOpsChecklist(lead)
  const total = Object.keys(checklist).length
  const complete = countCompletedOpsChecklist(checklist)
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
      Ops {complete}/{total}
    </span>
  )
}

function toDateTimeLocalInput(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toIsoDateTime(value: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

function getCrewNames(lead: CRMLead, crewPool: CrewMember[]) {
  return (lead.assignedCrew || [])
    .map(id => crewPool.find(member => member.id === id)?.name || `Crew #${id.slice(-4)}`)
}

function makePayoutEntryId() {
  return `payout_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function defaultRoleFromCrewMember(member?: CrewMember): CrewPayoutRole {
  if (!member) return 'mover'
  if (member.role === 'operations_lead' || member.role === 'manager') return 'crew_lead'
  return 'mover'
}

function buildCrewPayoutDraft(member?: CrewMember, existing?: Partial<CrewPayoutEntry>): CrewPayoutEntry {
  const role = existing?.role || defaultRoleFromCrewMember(member)
  const hourlyRate = Number(existing?.hourlyRate || getCrewRoleDefaultRate(role))
  const approvedHours = Number(existing?.approvedHours || 0)
  const reimbursementAmount = Number(existing?.reimbursementAmount || 0)
  const { laborPay } = computeCrewPayoutAmounts({
    approvedHours,
    hourlyRate,
    reimbursementAmount,
  })

  return {
    id: existing?.id || makePayoutEntryId(),
    userId: existing?.userId || member?.id,
    workerName: existing?.workerName || member?.name || '',
    workerEmail: existing?.workerEmail || member?.email || '',
    workerPhone: existing?.workerPhone || member?.phone || '',
    role,
    hourlyRate,
    approvedHours,
    laborPay,
    reimbursementAmount: reimbursementAmount || undefined,
    reimbursementNote: existing?.reimbursementNote || '',
    receiptReference: existing?.receiptReference || '',
    paymentMethod: existing?.paymentMethod || 'interac',
    payoutDestination: existing?.payoutDestination || member?.email || '',
    payoutStatus: existing?.payoutStatus || 'submitted',
    dispatchStatus: existing?.dispatchStatus || 'pending',
    dispatchToken: existing?.dispatchToken || uid('crew'),
    dispatchSentAt: existing?.dispatchSentAt,
    dispatchConfirmedAt: existing?.dispatchConfirmedAt,
    dispatchDeclinedAt: existing?.dispatchDeclinedAt,
    submittedAt: existing?.submittedAt,
    approvedAt: existing?.approvedAt,
    approvedBy: existing?.approvedBy,
    paidAt: existing?.paidAt,
    paidBy: existing?.paidBy,
    financeNote: existing?.financeNote || '',
    createdAt: existing?.createdAt,
    updatedAt: existing?.updatedAt,
  }
}

function sumCrewPayoutTotal(entries?: CrewPayoutEntry[]) {
  return (entries || []).reduce((sum, entry) => {
    const { totalPay } = computeCrewPayoutAmounts(entry)
    return sum + totalPay
  }, 0)
}

function getCrewDispatchUrl(entry: Pick<CrewPayoutEntry, 'dispatchToken'>) {
  if (!entry.dispatchToken) return ''
  if (typeof window === 'undefined') return `/crew/dispatch/${entry.dispatchToken}`
  return `${window.location.origin}/crew/dispatch/${entry.dispatchToken}`
}

export default function OperationsPage() {
  const currentUser = useCurrentUser()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [crewPool, setCrewPool] = useState<CrewMember[]>([])
  const [assigningJob, setAssigningJob] = useState<Job | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'calendar'>('calendar')
  const [branchFilter, setBranchFilter] = useState<string>('')
  const [activeFilters, setActiveFilters] = useState<OperationsFilterKey[]>([])
  const [calMonth, setCalMonth] = useState(() => todayISO().slice(0, 7)) // YYYY-MM

  const canManageCrew = currentUser?.role === 'owner' || currentUser?.role === 'manager' || currentUser?.role === 'operations_lead'
  const isOpsLead = currentUser?.role === 'operations_lead'

  async function loadJobs(branch?: string) {
    try {
      setLoading(true)
      const params = branch ? `?branch=${encodeURIComponent(branch)}` : ''
      const r = await fetch(`/api/sales/operations/jobs${params}`, { credentials: 'include' })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json() as { jobs: Job[] }
      setJobs(data.jobs)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs(branchFilter || undefined)
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((users: CrewMember[]) => setCrewPool(users.filter(u => u.role === 'crew' || u.role === 'manager' || u.role === 'operations_lead')))
      .catch(() => null)
  }, [branchFilter])

  function syncJobUpdate(updatedLead: CRMLead, updatedQuote?: CRMQuote | null) {
    setJobs(prev => prev.map(job => (
      job.lead.id === updatedLead.id
        ? {
            ...job,
            lead: updatedLead,
            quote: updatedQuote !== undefined ? updatedQuote : job.quote,
          }
        : job
    )))
  }

  async function markComplete(job: Job) {
    if (!window.confirm(`Mark ${job.lead.name}'s job as complete? This will trigger the post-move review request.`)) return
    setCompletingId(job.lead.id)
    try {
      await updateSalesLead(job.lead.id, {
        opsChecklist: {
          ...(job.lead.opsChecklist || {}),
          finalWalkthroughComplete: true,
        },
      })
      // Fire review request
      if (job.lead.email || job.lead.phone) {
        void fetch('/api/sales/review-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            leadId: job.lead.id,
            leadName: job.lead.name,
            leadEmail: job.lead.email,
            leadPhone: job.lead.phone,
            quoteNumber: job.quote?.number,
            channel: 'both',
          }),
        }).then(async response => {
          if (!response.ok) throw new Error('Job completed, but the customer-care follow-up needs attention.')
          const payload = await response.json() as { lead?: CRMLead | null }
          if (payload.lead) syncJobUpdate(payload.lead, job.quote)
        }).catch(nextError => setError(nextError instanceof Error ? nextError.message : 'Customer-care follow-up needs attention.'))
      }
      setCompletedIds(prev => new Set(Array.from(prev).concat(job.lead.id)))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCompletingId(null)
    }
  }

  const today = todayISO()
  const filteredJobs = useMemo(() => (
    activeFilters.length === 0
      ? jobs
      : jobs.filter(job => activeFilters.every(filter => matchesOperationsFilter(job, filter)))
  ), [activeFilters, jobs])
  const upcomingJobs = filteredJobs.filter(j => {
    const d = getJobMoveDate(j)
    return d && d >= today && !completedIds.has(j.lead.id)
  })
  const otherJobs = filteredJobs.filter(j => {
    const d = getJobMoveDate(j)
    return (!d || d < today) && !completedIds.has(j.lead.id)
  })
  const readyCount = upcomingJobs.filter(job => deriveDispatchReadiness(job).level === 'ready').length
  const missingTruckCount = upcomingJobs.filter(job => requiresTruck(job) && !hasTruckAssigned(job)).length
  const missingCrewCount = upcomingJobs.filter(job => !hasCrewRolePlan(job)).length
  const missingBriefingCount = upcomingJobs.filter(job => !deriveOpsChecklist(job.lead).jobPacketReady).length

  function toggleFilter(filter: OperationsFilterKey) {
    setActiveFilters(current =>
      current.includes(filter)
        ? current.filter(item => item !== filter)
        : [...current, filter]
    )
  }

  function JobCard({ job }: { job: Job }) {
    const lead = job.lead
    const quote = job.quote
    const moveDate = getJobMoveDate(job)
    const route = getJobRoute(job)
    const crewSize = quote?.crewSize
    const truckCount = getQuotedTruckCount(lead, quote)
    const estHours = quote?.estimatedHours
    const isCompleting = completingId === lead.id
    const readiness = deriveDispatchReadiness(job)
    const sharedReadiness = deriveJobReadiness(lead, quote)
    const customerConfirmed = hasCustomerConfirmation(job)
    const depositPaid = isDepositPaid(job)
    const crewAssigned = hasCrewRolePlan(job)
    const truckAssigned = hasTruckAssigned(job)

    return (
      <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <MoveDateBadge dateStr={moveDate} />
              {lead.branch && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BRANCH_COLORS[lead.branch] || 'bg-slate-100 text-slate-600'}`}>
                  {BRANCH_LABELS[lead.branch] || lead.branch}
                </span>
              )}
            </div>
            <div className="text-base font-semibold text-[#071421]">{lead.name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <PaymentBadge lead={lead} />
            <TruckReservationBadge lead={lead} quote={quote} />
            <OpsProgressBadge lead={lead} />
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${readinessBadgeClasses(readiness.level)}`}>
              {sharedReadiness.label} · {sharedReadiness.percent}%
            </span>
          </div>
        </div>

        {/* Route */}
        <div className="text-sm text-slate-600">
          <span className="font-medium">{route.origin}</span>
          <span className="mx-2 text-slate-400">→</span>
          <span className="font-medium">{route.destination}</span>
        </div>

        {/* Job details */}
        {(crewSize || truckCount || estHours) ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {crewSize ? <span>{crewSize} mover{crewSize > 1 ? 's' : ''}</span> : null}
            {truckCount ? <span>{truckCount === 1 ? '26ft truck' : `${truckCount} trucks`}</span> : null}
            {estHours ? <span>~{estHours}h estimated</span> : null}
          </div>
        ) : null}

        {/* Payment summary */}
        {quote && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <span className="text-slate-500">Deposit: <span className={`font-semibold ${lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' ? 'text-emerald-700' : 'text-amber-700'}`}>{formatMoney(quote.deposit)}{lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' ? ' ✓' : ''}</span></span>
            <span className="text-slate-500">Balance: <span className="font-semibold text-[#071421]">{formatMoney(quote.balance)}</span></span>
            <span className="text-slate-500">Total: <span className="font-semibold text-[#071421]">{formatMoney(quote.total)}</span></span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Quote amount</div>
            <div className="mt-1 text-sm font-semibold text-[#071421]">{quote ? formatMoney(quote.total) : 'TBD'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Estimated hours</div>
            <div className="mt-1 text-sm font-semibold text-[#071421]">{estHours ? `~${estHours}h` : 'TBD'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Crew: <span className={`font-semibold ${crewAssigned ? 'text-emerald-700' : 'text-rose-600'}`}>{crewAssigned ? 'Assigned' : 'Missing'}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Truck: <span className={`font-semibold ${truckAssigned ? 'text-emerald-700' : 'text-rose-600'}`}>{truckAssigned ? 'Assigned' : (requiresTruck(job) ? 'Missing' : 'Not needed')}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Deposit: <span className={`font-semibold ${depositPaid ? 'text-emerald-700' : 'text-amber-700'}`}>{depositPaid ? 'Paid' : 'Unpaid'}</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Customer confirmed: <span className={`font-semibold ${customerConfirmed ? 'text-emerald-700' : 'text-amber-700'}`}>{customerConfirmed ? 'Yes' : 'No'}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-[#071421]">Dispatch notes:</span> {readiness.reasons.join(' · ')}
        </div>

        {/* Assigned crew */}
        {(lead.assignedCrew?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {lead.assignedCrew!.map(id => {
              const member = crewPool.find(c => c.id === id)
              if (!member) return null
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#071421]/10 px-2.5 py-1 text-xs font-medium text-[#071421]">
                  👤 {member.name}
                </span>
              )
            })}
          </div>
        )}

        {/* Contact + actions */}
        <div className="flex flex-wrap items-center gap-2">
          {lead.phone ? (
            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-slate-50 transition">
              📞 {lead.phone}
            </a>
          ) : null}
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-slate-50 transition">
              📧 Email
            </a>
          ) : null}
          <div className="ml-auto flex gap-2">
            {canManageCrew && crewPool.length > 0 && (
              <button
                onClick={() => setAssigningJob(job)}
                className="rounded-lg border border-[#071421]/30 px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-[#071421]/5 transition"
              >
                Pre-Move Checklist
              </button>
            )}
            <Link
              href={`/sales/leads/${lead.id}`}
              className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition"
            >
              View Lead
            </Link>
            <button
              onClick={() => void markComplete(job)}
              disabled={isCompleting}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-60"
            >
              {isCompleting ? 'Completing...' : 'Mark Complete ✓'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="crm-shell space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#071421]">Operations</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dispatch Readiness ·{' '}
            {new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            {isOpsLead && currentUser?.name ? ` · ${currentUser.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Branch filter — hidden for ops_lead if they have a fixed branch */}
          {!isOpsLead && (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="">All branches</option>
              <option value="windsor">Windsor</option>
              <option value="waterloo">Waterloo / KW</option>
              <option value="london">London</option>
              <option value="ottawa">Ottawa</option>
            </select>
          )}
          {/* View toggle */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 text-sm font-medium transition ${viewMode === 'calendar' ? 'bg-[#071421] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              📅 Calendar
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 text-sm font-medium transition ${viewMode === 'cards' ? 'bg-[#071421] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              ☰ Cards
            </button>
          </div>
          <button onClick={() => void loadJobs(branchFilter || undefined)} className="crm-button text-sm">Refresh</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {OPERATIONS_FILTERS.map(filter => {
            const active = activeFilters.includes(filter.key)
            const count = jobs.filter(job => matchesOperationsFilter(job, filter.key)).length
            return (
              <button
                key={filter.key}
                onClick={() => toggleFilter(filter.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-[#071421] bg-[#071421] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {filter.label}{count > 0 ? ` · ${count}` : ''}
              </button>
            )
          })}
          {activeFilters.length > 0 && (
            <button
              onClick={() => setActiveFilters([])}
              className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="mt-3 text-xs text-slate-500">
          {filteredJobs.length} of {jobs.length} booked jobs match the current readiness filters.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Ready to dispatch</div>
          <div className={`mt-2 text-2xl font-bold ${readyCount > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>{readyCount}</div>
          <div className="mt-1 text-xs text-slate-500">Booked upcoming moves with checklist complete</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Needs briefing</div>
          <div className={`mt-2 text-2xl font-bold ${missingBriefingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{missingBriefingCount}</div>
          <div className="mt-1 text-xs text-slate-500">Crew packet still needs to be generated or checked</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Missing trucks</div>
          <div className={`mt-2 text-2xl font-bold ${missingTruckCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{missingTruckCount}</div>
          <div className="mt-1 text-xs text-slate-500">Booked moves still waiting on a reservation</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Missing crew</div>
          <div className={`mt-2 text-2xl font-bold ${missingCrewCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{missingCrewCount}</div>
          <div className="mt-1 text-xs text-slate-500">Booked moves without an assigned team</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">
          No booked jobs found. Jobs appear here when leads are marked Booked with a deposit.
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">
          No booked jobs match the current filters.
        </div>
      ) : viewMode === 'calendar' ? (
        <JobsCalendar
          jobs={filteredJobs}
          crewPool={crewPool}
          calMonth={calMonth}
          onMonthChange={setCalMonth}
          onSelectJob={job => setAssigningJob(job)}
          onJobUpdate={syncJobUpdate}
          canManageCrew={canManageCrew}
        />
      ) : (
        <>
          {/* Upcoming moves */}
          {upcomingJobs.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full bg-[#071421] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
                  Upcoming Moves
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {upcomingJobs.map(job => (
                  <JobCard key={job.lead.id} job={job} />
                ))}
              </div>
            </section>
          )}

          {/* Undated / past jobs */}
          {otherJobs.length > 0 && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
                  All Booked Jobs
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {otherJobs.map(job => (
                  <JobCard key={job.lead.id} job={job} />
                ))}
              </div>
            </section>
          )}

          {completedIds.size > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              {completedIds.size} job{completedIds.size > 1 ? 's' : ''} marked complete. Review requests sent automatically.
            </div>
          )}
        </>
      )}

      {/* Crew Assignment Modal */}
      {assigningJob && (
        <CrewAssignModal
          job={assigningJob}
          crewPool={crewPool}
          onClose={() => setAssigningJob(null)}
          onSave={updated => {
            syncJobUpdate(updated)
            setAssigningJob(null)
          }}
        />
      )}
    </div>
  )
}

function JobsCalendar({
  jobs,
  crewPool,
  calMonth,
  onMonthChange,
  onSelectJob,
  onJobUpdate,
  canManageCrew,
}: {
  jobs: Job[]
  crewPool: CrewMember[]
  calMonth: string
  onMonthChange: (m: string) => void
  onSelectJob: (job: Job) => void
  onJobUpdate: (lead: CRMLead, quote?: CRMQuote | null) => void
  canManageCrew: boolean
}) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [actualHours, setActualHours] = useState('')
  const [actualCrew, setActualCrew] = useState('')
  const [actualNotes, setActualNotes] = useState('')
  const [savingActuals, setSavingActuals] = useState(false)
  const [actualsMessage, setActualsMessage] = useState<string | null>(null)
  const [executionTimes, setExecutionTimes] = useState<Record<MoveExecutionPhase, string>>({} as Record<MoveExecutionPhase, string>)
  const [executionNotes, setExecutionNotes] = useState<Record<MoveExecutionPhase, string>>({} as Record<MoveExecutionPhase, string>)
  const [varianceReason, setVarianceReason] = useState('')
  const [issueCategory, setIssueCategory] = useState<MoveExecutionIssue['category']>('access')
  const [issueSeverity, setIssueSeverity] = useState<MoveExecutionIssue['severity']>('medium')
  const [issueNote, setIssueNote] = useState('')
  const [receiptsNote, setReceiptsNote] = useState('')
  const [customerFeedbackNote, setCustomerFeedbackNote] = useState('')
  const [savingExecutionLog, setSavingExecutionLog] = useState(false)
  const [executionLogMessage, setExecutionLogMessage] = useState<string | null>(null)

  useEffect(() => {
    setActualHours('')
    setActualCrew(selectedJob?.quote?.crewSize ? String(selectedJob.quote.crewSize) : '')
    setActualNotes('')
    setActualsMessage(null)
    const entries = buildDefaultMoveExecutionEntries(selectedJob?.lead.moveExecutionLog?.entries)
    setExecutionTimes(Object.fromEntries(entries.map(entry => [entry.phase, toDateTimeLocalInput(entry.timestamp)])) as Record<MoveExecutionPhase, string>)
    setExecutionNotes(Object.fromEntries(entries.map(entry => [entry.phase, entry.note || ''])) as Record<MoveExecutionPhase, string>)
    setVarianceReason(selectedJob?.lead.moveExecutionLog?.varianceReason || '')
    setIssueCategory('access')
    setIssueSeverity('medium')
    setIssueNote('')
    setReceiptsNote(selectedJob?.lead.moveExecutionLog?.receiptsNote || '')
    setCustomerFeedbackNote(selectedJob?.lead.moveExecutionLog?.customerFeedbackNote || '')
    setExecutionLogMessage(null)
  }, [selectedJob?.lead.id, selectedJob?.quote?.crewSize])

  useEffect(() => {
    if (selectedJob && !jobs.some(job => job.lead.id === selectedJob.lead.id)) {
      setSelectedJob(null)
    }
  }, [jobs, selectedJob])

  async function saveActuals() {
    if (!selectedJob) return
    setSavingActuals(true)
    setActualsMessage(null)
    try {
      const response = await fetch(`/api/sales/leads/${selectedJob.lead.id}/outcome`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actual_hours: actualHours ? Number(actualHours) : undefined,
          actual_crew: actualCrew ? Number(actualCrew) : undefined,
          notes: actualNotes.trim() || undefined,
        }),
      })
      const payload = await response.json() as {
        error?: string
        lead?: CRMLead
        quote?: CRMQuote | null
      }
      if (!response.ok) throw new Error(payload.error || 'Failed to save actuals')

      if (payload.lead) {
        const nextQuote = payload.quote === undefined ? selectedJob.quote : payload.quote
        onJobUpdate(payload.lead, nextQuote)
        setSelectedJob({ lead: payload.lead, quote: nextQuote || null })
        setActualsMessage(nextQuote ? `Actuals saved. Balance due is now ${formatMoney(nextQuote.balance)}.` : 'Actuals saved.')
      } else {
        setActualsMessage('Actuals saved.')
      }
    } catch (error) {
      setActualsMessage((error as Error).message)
    } finally {
      setSavingActuals(false)
    }
  }

  async function saveExecutionLog() {
    if (!selectedJob) return
    setSavingExecutionLog(true)
    setExecutionLogMessage(null)
    try {
      const existingIssues = selectedJob.lead.moveExecutionLog?.issues || []
      const nextIssues = issueNote.trim()
        ? [
            ...existingIssues,
            {
              id: uid('issue'),
              category: issueCategory,
              severity: issueSeverity,
              note: issueNote.trim(),
              createdAt: new Date().toISOString(),
            },
          ]
        : existingIssues
      const entries = MOVE_EXECUTION_PHASES.map(({ phase, label }) => ({
        id: `move_${phase}`,
        phase,
        label,
        timestamp: executionTimes[phase] || undefined,
        note: executionNotes[phase]?.trim() || undefined,
      }))
      const updated = await updateSalesLead(selectedJob.lead.id, {
        moveExecutionLog: {
          ...(selectedJob.lead.moveExecutionLog || {}),
          predictedHours: selectedJob.quote?.estimatedHours,
          actualHours: actualHours ? Number(actualHours) : selectedJob.lead.moveExecutionLog?.actualHours,
          varianceReason: varianceReason.trim() || undefined,
          entries,
          issues: nextIssues,
          receiptsNote: receiptsNote.trim() || undefined,
          customerFeedbackNote: customerFeedbackNote.trim() || undefined,
        },
      })
      onJobUpdate(updated, selectedJob.quote)
      setSelectedJob({ lead: updated, quote: selectedJob.quote })
      setIssueNote('')
      setExecutionLogMessage('Move log saved.')
    } catch (error) {
      setExecutionLogMessage((error as Error).message || 'Failed to save move log.')
    } finally {
      setSavingExecutionLog(false)
    }
  }

  const [year, month] = calMonth.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const startOffset = firstDay.getDay() // 0=Sun
  const totalDays = lastDay.getDate()

  const jobsByDate = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const job of jobs) {
      const d = getJobMoveDate(job)
      if (!d) continue
      const list = map.get(d) || []
      list.push(job)
      map.set(d, list)
    }
    return map
  }, [jobs])

  function prevMonth() {
    const d = new Date(year, month - 2, 1)
    onMonthChange(d.toISOString().slice(0, 7))
  }

  function nextMonth() {
    const d = new Date(year, month, 1)
    onMonthChange(d.toISOString().slice(0, 7))
  }

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  const today = todayISO()
  const selectedRoute = selectedJob ? getJobRoute(selectedJob) : null
  const selectedChecklist = selectedJob ? deriveOpsChecklist(selectedJob.lead) : null
  const selectedReadiness = selectedJob ? deriveDispatchReadiness(selectedJob) : null
  const selectedJobReadiness = selectedJob ? deriveJobReadiness(selectedJob.lead, selectedJob.quote) : null
  const selectedAccessAssessment = selectedJob ? deriveAccessComplexityAssessment(selectedJob.lead) : null

  // Build 6-row grid
  const cells: Array<{ date: string | null; day: number | null }> = []
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, day: null })
  for (let d = 1; d <= totalDays; d++) {
    const mm = String(month).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push({ date: `${year}-${mm}-${dd}`, day: d })
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null })

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 transition">← Prev</button>
        <h2 className="font-display text-lg font-bold text-[#071421]">{monthLabel}</h2>
        <button onClick={nextMonth} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 transition">Next →</button>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">Windsor</span>
        <span className="rounded-full bg-purple-100 px-3 py-1 text-purple-800">Waterloo / KW</span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">London</span>
        <span className="rounded-full bg-red-100 px-3 py-1 text-red-800">Ottawa</span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Needs setup</span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Ready</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Grey · past date</span>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px rounded-t-xl overflow-hidden border border-slate-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="bg-[#071421] px-2 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-white">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px border-l border-b border-slate-200 rounded-b-xl overflow-hidden bg-slate-200">
        {cells.map((cell, i) => {
          const dayJobs = cell.date ? (jobsByDate.get(cell.date) || []) : []
          const isToday = cell.date === today
          const hasReadinessGap = dayJobs.some(job =>
            deriveDispatchReadiness(job).level !== 'ready'
          )
          const dayTone =
            !cell.date ? 'bg-slate-50' :
            cell.date < today ? 'bg-slate-100' :
            hasReadinessGap ? 'bg-amber-50' :
            dayJobs.length > 0 ? 'bg-emerald-50' :
            'bg-white'
          return (
            <div
              key={i}
              className={`min-h-[112px] p-1.5 ${dayTone} ${isToday ? 'ring-2 ring-inset ring-[#C99700]' : ''}`}
            >
              {cell.day !== null && (
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-[#C99700] text-white' : 'text-slate-500'}`}>
                    {cell.day}
                  </div>
                  {dayJobs.length > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                      hasReadinessGap ? 'bg-amber-100 text-amber-800' :
                      'bg-emerald-100 text-emerald-700'
                    }`}>
                      {dayJobs.length} job{dayJobs.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-1">
                {dayJobs.map(job => {
                  const branchColor = job.lead.branch ? BRANCH_COLORS[job.lead.branch] : 'bg-[#071421]/10 text-[#071421]'
                  const readiness = deriveDispatchReadiness(job)
                  const crewNames = (job.lead.assignedCrew?.length ?? 0) > 0
                    ? `${job.lead.assignedCrew!.length} crew`
                    : 'No crew'
                  return (
                    <button
                      key={job.lead.id}
                      onClick={() => setSelectedJob(selectedJob?.lead.id === job.lead.id ? null : job)}
                      className={`w-full rounded-md px-1.5 py-1 text-left text-[10px] font-semibold leading-tight transition hover:opacity-80 ${branchColor}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{job.lead.name}</span>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${readinessBadgeClasses(readiness.level)}`}>
                          {readiness.level === 'ready' ? 'Ready' : 'Setup'}
                        </span>
                      </div>
                      <div className="truncate font-normal opacity-75">{crewNames} · {job.quote?.estimatedHours ? `~${job.quote.estimatedHours}h` : 'TBD'}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Selected job detail modal */}
      {selectedJob && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 pt-10 backdrop-blur-sm"
          onClick={event => { if (event.target === event.currentTarget) setSelectedJob(null) }}
        >
        <div className="max-h-[calc(100vh-5rem)] w-full max-w-5xl space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-bold text-[#071421]">{selectedJob.lead.name}</span>
                {selectedJob.lead.branch && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BRANCH_COLORS[selectedJob.lead.branch] || 'bg-slate-100 text-slate-600'}`}>
                    {BRANCH_LABELS[selectedJob.lead.branch] || selectedJob.lead.branch}
                  </span>
                )}
                <PaymentBadge lead={selectedJob.lead} />
                <TruckReservationBadge lead={selectedJob.lead} quote={selectedJob.quote} />
                <OpsProgressBadge lead={selectedJob.lead} />
                {selectedReadiness && selectedJobReadiness ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${readinessBadgeClasses(selectedReadiness.level)}`}>
                    {selectedJobReadiness.label} · {selectedJobReadiness.percent}%
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {selectedRoute?.origin || '—'} → {selectedRoute?.destination || '—'}
              </div>
            </div>
            <button onClick={() => setSelectedJob(null)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Move date</div>
              <div className="mt-1 text-sm font-semibold text-[#071421]">
                {getJobMoveDate(selectedJob) ? formatDate(getJobMoveDate(selectedJob) || '') : 'TBD'}
              </div>
            </div>
            {selectedJob.quote?.crewSize && (
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew size</div>
                <div className="mt-1 text-sm font-semibold text-[#071421]">{selectedJob.quote.crewSize} movers</div>
              </div>
            )}
            {getQuotedTruckCount(selectedJob.lead, selectedJob.quote) && (
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Trucks</div>
                <div className="mt-1 text-sm font-semibold text-[#071421]">{getTruckPlanLabel(selectedJob.lead, selectedJob.quote)}</div>
              </div>
            )}
            {selectedJob.quote?.estimatedHours && (
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Est. hours</div>
                <div className="mt-1 text-sm font-semibold text-[#071421]">~{selectedJob.quote.estimatedHours}h</div>
              </div>
            )}
          </div>

          {selectedJob.quote && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-500">Deposit: <span className={`font-semibold ${selectedJob.lead.paymentStatus === 'deposit_received' || selectedJob.lead.paymentStatus === 'paid_in_full' ? 'text-emerald-700' : 'text-amber-700'}`}>{formatMoney(selectedJob.quote.deposit)}{selectedJob.lead.paymentStatus === 'deposit_received' || selectedJob.lead.paymentStatus === 'paid_in_full' ? ' ✓' : ''}</span></span>
              <span className="text-slate-500">Balance due: <span className="font-semibold text-[#071421]">{formatMoney(selectedJob.quote.balance)}</span></span>
              <span className="text-slate-500">Total: <span className="font-semibold text-[#071421]">{formatMoney(selectedJob.quote.total)}</span></span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Truck reservation</div>
              <div className="mt-2 text-sm font-semibold text-[#071421]">{getTruckPlanLabel(selectedJob.lead, selectedJob.quote)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TruckReservationBadge lead={selectedJob.lead} quote={selectedJob.quote} />
                {selectedJob.lead.truckVendor && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {TRUCK_VENDOR_LABELS[selectedJob.lead.truckVendor]}
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <div>Pickup: <span className="font-medium text-[#071421]">{selectedJob.lead.truckPickupLocation || 'TBD'}</span></div>
                <div>Pickup time: <span className="font-medium text-[#071421]">{formatDateTime(selectedJob.lead.truckPickupTime)}</span></div>
                <div>Return: <span className="font-medium text-[#071421]">{selectedJob.lead.truckReturnLocation || 'TBD'}</span></div>
                <div>Reservation #: <span className="font-medium text-[#071421]">{selectedJob.lead.truckReservationNumber || 'TBD'}</span></div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Readiness</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                <span className={selectedChecklist?.crewAssigned ? 'font-semibold text-emerald-700' : ''}>Crew assigned</span>
                <span className={selectedChecklist?.truckReserved ? 'font-semibold text-emerald-700' : ''}>Truck reserved</span>
                <span className={(selectedChecklist?.accessConfirmed || selectedAccessAssessment?.accessAutoClear) ? 'font-semibold text-emerald-700' : ''}>Access clear</span>
                <span className={(selectedChecklist?.parkingConfirmed || selectedAccessAssessment?.parkingAutoClear) ? 'font-semibold text-emerald-700' : ''}>Parking clear</span>
                <span className={selectedChecklist?.toolsReady ? 'font-semibold text-emerald-700' : ''}>Equipment ready</span>
                <span className={selectedChecklist?.jobPacketReady ? 'font-semibold text-emerald-700' : ''}>Crew briefing ready</span>
              </div>
              {selectedAccessAssessment ? (
                <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                  selectedAccessAssessment.status === 'clear'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : selectedAccessAssessment.status === 'high_risk'
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  <div className="font-semibold">{selectedAccessAssessment.label}{selectedAccessAssessment.extraMinutes > 0 ? ` · +${selectedAccessAssessment.extraMinutes} min` : ''}</div>
                  <div className="mt-1">{selectedAccessAssessment.summary}</div>
                </div>
              ) : null}
              {selectedReadiness ? (
                <div className="mt-3 text-xs text-slate-500">
                  {selectedReadiness.reasons.join(' · ')}
                </div>
              ) : null}
            </div>
          </div>

          {(selectedJob.lead.assignedCrew?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Assigned crew</div>
              <div className="flex flex-wrap gap-1.5 text-xs text-[#071421]">
                {getCrewNames(selectedJob.lead, crewPool).join(', ')}
              </div>
            </div>
          )}

          {(selectedJob.lead.crewHours?.length ?? 0) > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew hours</div>
              <div className="flex flex-wrap gap-1.5 text-xs text-slate-600">
                {selectedJob.lead.crewHours!.map(entry => (
                  <span key={entry.userId} className="rounded-full bg-slate-100 px-2 py-1">
                    {(entry.name || crewPool.find(member => member.id === entry.userId)?.name || `Crew #${entry.userId.slice(-4)}`)}: {entry.hours || 0}h
                  </span>
                ))}
              </div>
            </div>
          )}

          {(selectedJob.lead.crewPayouts?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew pay sheet</div>
                <div className="text-xs font-semibold text-[#071421]">{formatMoney(sumCrewPayoutTotal(selectedJob.lead.crewPayouts))}</div>
              </div>
              <div className="mt-3 space-y-2">
                {selectedJob.lead.crewPayouts!.map(entry => {
                  const { totalPay } = computeCrewPayoutAmounts(entry)
                  return (
                    <div key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-[#071421]">{entry.workerName}</div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {CREW_PAYOUT_STATUS_LABELS[entry.payoutStatus || 'submitted']}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-500">
                        {CREW_PAYOUT_ROLE_LABELS[entry.role]} · {entry.approvedHours}h @ {formatMoney(entry.hourlyRate)}/hr
                        {entry.reimbursementAmount ? ` · reimb. ${formatMoney(entry.reimbursementAmount)}` : ''}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-500">
                          {entry.paymentMethod ? `${CREW_PAYOUT_METHOD_LABELS[entry.paymentMethod]}${entry.payoutDestination ? ` · ${entry.payoutDestination}` : ''}` : 'Payout details pending'}
                        </span>
                        <span className="font-semibold text-[#071421]">{formatMoney(totalPay)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedJob.lead.crewNote && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 whitespace-pre-wrap">
              <span className="font-semibold">Crew note:</span>{' '}{selectedJob.lead.crewNote}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Actual Hours / Overage</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-[11px] font-semibold text-slate-500">Actual hours</div>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={actualHours}
                  onChange={event => setActualHours(event.target.value)}
                  className="crm-input mt-1 w-full"
                  placeholder={selectedJob.quote?.estimatedHours ? `Quoted: ${selectedJob.quote.estimatedHours}h` : 'e.g. 5.5'}
                />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-500">Actual crew</div>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={actualCrew}
                  onChange={event => setActualCrew(event.target.value)}
                  className="crm-input mt-1 w-full"
                  placeholder={selectedJob.quote?.crewSize ? String(selectedJob.quote.crewSize) : 'e.g. 3'}
                />
              </div>
              <div className="md:col-span-1">
                <div className="text-[11px] font-semibold text-slate-500">Override note</div>
                <textarea
                  rows={3}
                  value={actualNotes}
                  onChange={event => setActualNotes(event.target.value)}
                  className="crm-input mt-1 w-full resize-none"
                  placeholder="Required if a binding move ran over quoted hours."
                />
              </div>
            </div>
            {actualsMessage && (
              <div className={`mt-3 text-xs ${actualsMessage.toLowerCase().includes('failed') || actualsMessage.toLowerCase().includes('require') ? 'text-rose-600' : 'text-emerald-700'}`}>
                {actualsMessage}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void saveActuals()}
                disabled={savingActuals || !actualHours}
                className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {savingActuals ? 'Saving...' : 'Save Actuals'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Move Execution Log</div>
                <div className="mt-1 text-xs text-slate-500">
                  Capture actual timing so the estimator learns where the move ran tight or loose.
                </div>
              </div>
              {selectedJob.lead.moveExecutionLog?.varianceHours !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  selectedJob.lead.moveExecutionLog.varianceHours > 0.5
                    ? 'bg-rose-100 text-rose-700'
                    : selectedJob.lead.moveExecutionLog.varianceHours < -0.5
                      ? 'bg-sky-100 text-sky-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {selectedJob.lead.moveExecutionLog.varianceHours > 0 ? '+' : ''}{selectedJob.lead.moveExecutionLog.varianceHours}h vs estimate
                </span>
              )}
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {MOVE_EXECUTION_PHASES.map(({ phase, label }) => (
                <div key={phase} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-xs font-semibold text-[#071421]">{label}</div>
                    <input
                      type="datetime-local"
                      value={executionTimes[phase] || ''}
                      onChange={event => setExecutionTimes(prev => ({ ...prev, [phase]: event.target.value }))}
                      className="w-40 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-[#071421]"
                    />
                  </div>
                  <input
                    value={executionNotes[phase] || ''}
                    onChange={event => setExecutionNotes(prev => ({ ...prev, [phase]: event.target.value }))}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-[#071421]"
                    placeholder="Phase note"
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-500">Variance reason</span>
                <textarea
                  rows={3}
                  value={varianceReason}
                  onChange={event => setVarianceReason(event.target.value)}
                  className="crm-input mt-1 w-full resize-none"
                  placeholder="Why did actual timing differ from the estimate?"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-500">Receipts / cost notes</span>
                <textarea
                  rows={3}
                  value={receiptsNote}
                  onChange={event => setReceiptsNote(event.target.value)}
                  className="crm-input mt-1 w-full resize-none"
                  placeholder="Gas, parking, materials, tolls, receipt links, reimbursement notes"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-[11px] font-semibold text-slate-500">Customer feedback / completion note</span>
                <textarea
                  rows={2}
                  value={customerFeedbackNote}
                  onChange={event => setCustomerFeedbackNote(event.target.value)}
                  className="crm-input mt-1 w-full resize-none"
                  placeholder="Customer happy, complaint, damage note, referral/review opportunity"
                />
              </label>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold text-slate-500">Add issue / learning signal</div>
              <div className="mt-2 grid gap-2 md:grid-cols-[160px_140px_1fr]">
                <select value={issueCategory} onChange={event => setIssueCategory(event.target.value as MoveExecutionIssue['category'])} className="crm-input">
                  <option value="access">Access</option>
                  <option value="inventory">Inventory</option>
                  <option value="customer_delay">Customer delay</option>
                  <option value="crew">Crew</option>
                  <option value="truck">Truck</option>
                  <option value="damage">Damage</option>
                  <option value="weather">Weather</option>
                  <option value="traffic">Traffic</option>
                  <option value="other">Other</option>
                </select>
                <select value={issueSeverity} onChange={event => setIssueSeverity(event.target.value as MoveExecutionIssue['severity'])} className="crm-input">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input
                  value={issueNote}
                  onChange={event => setIssueNote(event.target.value)}
                  className="crm-input"
                  placeholder="What happened?"
                />
              </div>
              {(selectedJob.lead.moveExecutionLog?.issues?.length ?? 0) > 0 && (
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  {selectedJob.lead.moveExecutionLog!.issues!.map(issue => (
                    <div key={issue.id} className="rounded-md bg-white px-2 py-1">
                      <span className="font-semibold capitalize">{issue.category.replace(/_/g, ' ')}</span>
                      <span className="text-slate-400"> · {issue.severity}</span>
                      <span> — {issue.note}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {executionLogMessage && (
              <div className={`mt-3 text-xs ${executionLogMessage.toLowerCase().includes('failed') ? 'text-rose-600' : 'text-emerald-700'}`}>
                {executionLogMessage}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void saveExecutionLog()}
                disabled={savingExecutionLog}
                className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {savingExecutionLog ? 'Saving...' : 'Save Move Log'}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            {selectedJob.lead.phone && (
              <a href={`tel:${selectedJob.lead.phone}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-slate-50 transition">
                📞 {selectedJob.lead.phone}
              </a>
            )}
            {canManageCrew && (
              <button
                onClick={() => { onSelectJob(selectedJob); setSelectedJob(null) }}
                className="rounded-lg border border-[#071421]/30 px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-[#071421]/5 transition"
              >
                Pre-Move Checklist
              </button>
            )}
            <Link href={`/sales/leads/${selectedJob.lead.id}`} className="ml-auto rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition">
              View Full Lead →
            </Link>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}

function CrewAssignModal({
  job,
  crewPool,
  onClose,
  onSave,
}: {
  job: Job
  crewPool: CrewMember[]
  onClose: () => void
  onSave: (lead: CRMLead) => void
}) {
  const [selected, setSelected] = useState<string[]>(job.lead.assignedCrew ?? [])
  const [note, setNote] = useState(job.lead.crewNote ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const quotedTruckCount = getQuotedTruckCount(job.lead, job.quote)
  const truckRequired = !!quotedTruckCount
  const [truckStatus, setTruckStatus] = useState<TruckReservationStatus>(
    truckRequired
      ? (job.lead.truckReservationStatus || 'needs_booking')
      : 'not_needed'
  )
  const [truckVendor, setTruckVendor] = useState<TruckVendor>(job.lead.truckVendor || 'uhaul')
  const [truckSize, setTruckSize] = useState(job.lead.truckSize || '26ft')
  const [pickupLocation, setPickupLocation] = useState(job.lead.truckPickupLocation || '')
  const [pickupTime, setPickupTime] = useState(toDateTimeLocalInput(job.lead.truckPickupTime))
  const [returnLocation, setReturnLocation] = useState(job.lead.truckReturnLocation || '')
  const [reservationNumber, setReservationNumber] = useState(job.lead.truckReservationNumber || '')
  const [reservationNotes, setReservationNotes] = useState(job.lead.truckReservationNotes || '')
  const initialChecklist = deriveOpsChecklist(job.lead)
  const accessAssessment = deriveAccessComplexityAssessment(job.lead)
  const [accessConfirmed, setAccessConfirmed] = useState(initialChecklist.accessConfirmed ?? false)
  const [parkingConfirmed, setParkingConfirmed] = useState(initialChecklist.parkingConfirmed ?? false)
  const [toolsReady, setToolsReady] = useState(initialChecklist.toolsReady ?? false)
  const [jobPacketReady, setJobPacketReady] = useState(initialChecklist.jobPacketReady ?? false)
  const [finalWalkthroughComplete, setFinalWalkthroughComplete] = useState(initialChecklist.finalWalkthroughComplete ?? false)
  const [crewHours, setCrewHours] = useState<Record<string, string>>(() =>
    Object.fromEntries((job.lead.crewHours || []).map(entry => [entry.userId, entry.hours ? String(entry.hours) : '']))
  )
  const [payoutEntries, setPayoutEntries] = useState<CrewPayoutEntry[]>(() => {
    if ((job.lead.crewPayouts?.length ?? 0) > 0) {
      return job.lead.crewPayouts!.map(entry => buildCrewPayoutDraft(undefined, entry))
    }

    return (job.lead.assignedCrew || []).map(id => {
      const member = crewPool.find(item => item.id === id)
      const hours = Number((job.lead.crewHours || []).find(entry => entry.userId === id)?.hours || 0)
      return buildCrewPayoutDraft(member, {
        userId: id,
        approvedHours: hours,
      })
    })
  })
  const [busy, setBusy] = useState(false)
  const requiredCrewCount = Number(job.quote?.crewSize || selected.length || 0)
  const requiredDriverCount = Number(quotedTruckCount || 0)
  const assignedCrewCount = payoutEntries.filter(entry => entry.workerName.trim()).length
  const assignedDriverCount = payoutEntries.filter(entry => entry.role === 'driver' || entry.role === 'crew_lead').length
  const crewRolePlanReady = requiredCrewCount > 0
    ? assignedCrewCount >= requiredCrewCount && assignedDriverCount >= requiredDriverCount
    : selected.length > 0 || assignedCrewCount > 0

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function updateCrewHour(userId: string, value: string) {
    setCrewHours(prev => ({ ...prev, [userId]: value }))
  }

  function addSelectedCrewToPaySheet() {
    setPayoutEntries(current => {
      const existingUserIds = new Set(current.map(entry => entry.userId).filter(Boolean))
      const additions = selected
        .filter(id => !existingUserIds.has(id))
        .map(id => {
          const member = crewPool.find(item => item.id === id)
          return buildCrewPayoutDraft(member, {
            userId: id,
            approvedHours: Number(crewHours[id] || 0),
          })
        })
      return [...current, ...additions]
    })
  }

  function addManualPayEntry() {
    setPayoutEntries(current => [...current, buildCrewPayoutDraft()])
  }

  function updatePayoutEntry(index: number, patch: Partial<CrewPayoutEntry>) {
    setPayoutEntries(current =>
      current.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry
        const nextRole = (patch.role || entry.role || 'mover') as CrewPayoutRole
        const hourlyRate = patch.hourlyRate !== undefined
          ? Number(patch.hourlyRate || 0)
          : (patch.role ? getCrewRoleDefaultRate(nextRole) : entry.hourlyRate)
        const approvedHours = patch.approvedHours !== undefined ? Number(patch.approvedHours || 0) : entry.approvedHours
        const reimbursementAmount = patch.reimbursementAmount !== undefined
          ? Number(patch.reimbursementAmount || 0)
          : Number(entry.reimbursementAmount || 0)
        const { laborPay } = computeCrewPayoutAmounts({
          approvedHours,
          hourlyRate,
          reimbursementAmount,
        })
        return {
          ...entry,
          ...patch,
          role: nextRole,
          hourlyRate,
          approvedHours,
          reimbursementAmount: reimbursementAmount || undefined,
          laborPay,
        }
      })
    )
  }

  function removePayoutEntry(index: number) {
    setPayoutEntries(current => current.filter((_, entryIndex) => entryIndex !== index))
  }

  async function copyCrewDispatchLink(index: number) {
    const entry = payoutEntries[index]
    const url = getCrewDispatchUrl(entry)
    if (!url) return
    await navigator.clipboard?.writeText(url)
    updatePayoutEntry(index, {
      dispatchStatus: entry.dispatchStatus === 'confirmed' ? 'confirmed' : 'sent',
      dispatchSentAt: entry.dispatchSentAt || new Date().toISOString(),
    })
    setMessage(`Dispatch link copied for ${entry.workerName || 'worker'}.`)
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const { updateSalesLead } = await import('@/lib/sales-api')
      const hoursPayload = selected
        .map<CrewHoursEntry>(id => {
          const member = crewPool.find(item => item.id === id)
          const parsedHours = Number(crewHours[id] || 0)
          return {
            userId: id,
            name: member?.name,
            role: member?.role,
            hours: Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : undefined,
          }
        })
        .filter(entry => entry.hours !== undefined || entry.name || entry.role)

      const payoutsPayload = payoutEntries.reduce<CrewPayoutEntry[]>((list, entry) => {
          const role = entry.role || 'mover'
          const hourlyRate = Number(entry.hourlyRate || getCrewRoleDefaultRate(role))
          const approvedHours = Number(entry.approvedHours || 0)
          const reimbursementAmount = Number(entry.reimbursementAmount || 0)
          const { laborPay } = computeCrewPayoutAmounts({
            approvedHours,
            hourlyRate,
            reimbursementAmount,
          })
          if (!entry.workerName.trim()) return list
          list.push({
            ...entry,
            workerName: entry.workerName.trim(),
            workerEmail: entry.workerEmail?.trim() || undefined,
            workerPhone: entry.workerPhone?.trim() || undefined,
            role,
            hourlyRate,
            approvedHours,
            laborPay,
            reimbursementAmount: reimbursementAmount > 0 ? reimbursementAmount : undefined,
            reimbursementNote: entry.reimbursementNote?.trim() || undefined,
            receiptReference: entry.receiptReference?.trim() || undefined,
            paymentMethod: entry.paymentMethod || 'interac',
            payoutDestination: entry.payoutDestination?.trim() || undefined,
            payoutStatus: entry.payoutStatus === 'approved' || entry.payoutStatus === 'paid'
              ? entry.payoutStatus
              : 'submitted',
            dispatchStatus: entry.dispatchStatus || 'pending',
            dispatchToken: entry.dispatchToken || uid('crew'),
            dispatchSentAt: entry.dispatchSentAt,
            dispatchConfirmedAt: entry.dispatchConfirmedAt,
            dispatchDeclinedAt: entry.dispatchDeclinedAt,
          } satisfies CrewPayoutEntry)
          return list
        }, [])

      const updated = await updateSalesLead(job.lead.id, {
        assignedCrew: selected,
        crewNote: note || undefined,
        crewHours: hoursPayload.length > 0 ? hoursPayload : undefined,
        crewPayouts: payoutsPayload.length > 0 ? payoutsPayload : undefined,
        truckReservationStatus: truckRequired ? truckStatus : 'not_needed',
        truckVendor: truckRequired ? truckVendor : undefined,
        truckSize: truckRequired ? truckSize || '26ft' : undefined,
        truckPickupLocation: truckRequired ? pickupLocation || undefined : undefined,
        truckPickupTime: truckRequired ? toIsoDateTime(pickupTime) : undefined,
        truckReturnLocation: truckRequired ? returnLocation || undefined : undefined,
        truckReservationNumber: truckRequired ? reservationNumber || undefined : undefined,
        truckReservationNotes: truckRequired ? reservationNotes || undefined : undefined,
        opsChecklist: {
          accessConfirmed: accessConfirmed || accessAssessment.accessAutoClear,
          parkingConfirmed: parkingConfirmed || accessAssessment.parkingAutoClear,
          toolsReady,
          jobPacketReady,
          finalWalkthroughComplete,
        },
      } as Partial<CRMLead>)
      onSave(updated as CRMLead)
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4 py-8"
      style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-start">
      <div className="w-full overflow-hidden rounded-xl bg-white shadow-none">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-[#071421] px-6 py-5" style={{ borderBottom: '2px solid #C99700' }}>
          <div>
            <h2 className="text-base font-bold text-white">Pre-Move Checklist</h2>
            <p className="mt-0.5 text-xs text-white/60">{job.lead.name} — {getJobMoveDate(job) || 'Date TBD'}</p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-white/10 px-3 py-1 text-sm font-semibold text-white hover:bg-white/20">Close</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Quoted truck plan</div>
            <div className="mt-1 text-sm font-semibold text-[#071421]">{getTruckPlanLabel(job.lead, job.quote)}</div>
            <div className="mt-1 text-xs text-slate-500">Truck count is pulled directly from the quote and cannot be changed here.</div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew assignment</div>
                <div className="space-y-2">
                  {crewPool.map(member => (
                    <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:bg-slate-50 transition">
                      <input
                        type="checkbox"
                        checked={selected.includes(member.id)}
                        onChange={() => toggle(member.id)}
                        className="h-4 w-4 accent-[#071421]"
                      />
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#071421] text-xs font-bold text-[#C99700]">
                        {member.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[#071421]">{member.name}</div>
                        <div className="text-xs capitalize text-slate-400">{member.role.replace('_', ' ')}</div>
                      </div>
                    </label>
                  ))}
                  {crewPool.length === 0 && (
                    <p className="text-sm text-slate-400">No crew members added yet. Go to Team → Add Team Member.</p>
                  )}
                </div>
              </div>

              <label className="block">
                <span className="crm-label">Crew Notes</span>
                <textarea
                  className="crm-input mt-1 h-20 resize-none"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. Marcus leads, bring extra wardrobe boxes"
                />
              </label>

              {selected.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew hours</div>
                  <div className="space-y-2">
                    {selected.map(userId => {
                      const member = crewPool.find(item => item.id === userId)
                      return (
                        <div key={userId} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-[#071421]">{member?.name || `Crew #${userId.slice(-4)}`}</div>
                            <div className="text-xs capitalize text-slate-400">{member?.role?.replace('_', ' ') || 'crew'}</div>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.25"
                            value={crewHours[userId] || ''}
                            onChange={event => updateCrewHour(userId, event.target.value)}
                            className="crm-input w-28"
                            placeholder="Hours"
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew pay sheet</div>
                    <div className="mt-1 text-xs text-slate-500">Submit the workers, hours, and reimbursement details for this move. Finance will review before payout.</div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={addSelectedCrewToPaySheet} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#071421] hover:bg-slate-50 transition">
                      + Add selected crew
                    </button>
                    <button type="button" onClick={addManualPayEntry} className="rounded-lg bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition">
                      + Add contractor
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                    Required crew: <span className="font-semibold text-[#071421]">{requiredCrewCount || 'TBD'}</span>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                    Required drivers: <span className="font-semibold text-[#071421]">{requiredDriverCount}</span>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                    Assigned drivers: <span className={`font-semibold ${assignedDriverCount >= requiredDriverCount ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {assignedDriverCount}
                    </span>
                  </div>
                </div>

                <div className="mt-3 space-y-3">
                  {payoutEntries.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-400">
                      No payout entries added yet.
                    </div>
                  )}
                  {payoutEntries.map((entry, index) => {
                    const { totalPay } = computeCrewPayoutAmounts(entry)
                    return (
                      <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-[#071421]">{entry.workerName || `Worker ${index + 1}`}</div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              entry.dispatchStatus === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                              entry.dispatchStatus === 'declined' ? 'bg-rose-100 text-rose-700' :
                              entry.dispatchStatus === 'sent' ? 'bg-sky-100 text-sky-700' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {CREW_DISPATCH_STATUS_LABELS[entry.dispatchStatus || 'pending']}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {CREW_PAYOUT_STATUS_LABELS[entry.payoutStatus || 'submitted']}
                            </span>
                            <button type="button" onClick={() => removePayoutEntry(index)} className="text-slate-300 hover:text-rose-500 transition">✕</button>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="crm-label">Worker name</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.workerName}
                              onChange={e => updatePayoutEntry(index, { workerName: e.target.value })}
                              placeholder="Fidelis N."
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Email / Interac</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.workerEmail || ''}
                              onChange={e => updatePayoutEntry(index, {
                                workerEmail: e.target.value,
                                payoutDestination: entry.paymentMethod === 'interac' && !entry.payoutDestination ? e.target.value : entry.payoutDestination,
                              })}
                              placeholder="worker@email.com"
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Phone</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.workerPhone || ''}
                              onChange={e => updatePayoutEntry(index, { workerPhone: e.target.value })}
                              placeholder="226-555-0100"
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Role</span>
                            <select
                              className="crm-input mt-1"
                              value={entry.role}
                              onChange={e => updatePayoutEntry(index, { role: e.target.value as CrewPayoutRole })}
                            >
                              {(Object.keys(CREW_PAYOUT_ROLE_LABELS) as CrewPayoutRole[]).map(role => (
                                <option key={role} value={role}>{CREW_PAYOUT_ROLE_LABELS[role]} · {formatMoney(CREW_ROLE_DEFAULT_RATES[role])}/hr</option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="crm-label">Dispatch status</span>
                            <select
                              className="crm-input mt-1"
                              value={entry.dispatchStatus || 'pending'}
                              onChange={e => updatePayoutEntry(index, { dispatchStatus: e.target.value as CrewDispatchStatus })}
                            >
                              {(Object.keys(CREW_DISPATCH_STATUS_LABELS) as CrewDispatchStatus[]).map(status => (
                                <option key={status} value={status}>{CREW_DISPATCH_STATUS_LABELS[status]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="crm-label">Hours</span>
                            <input
                              type="number"
                              min="0"
                              step="0.25"
                              className="crm-input mt-1"
                              value={entry.approvedHours || ''}
                              onChange={e => updatePayoutEntry(index, { approvedHours: Number(e.target.value || 0) })}
                              placeholder="8"
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Hourly rate</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="crm-input mt-1"
                              value={entry.hourlyRate || ''}
                              onChange={e => updatePayoutEntry(index, { hourlyRate: Number(e.target.value || 0) })}
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Reimbursement</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="crm-input mt-1"
                              value={entry.reimbursementAmount || ''}
                              onChange={e => updatePayoutEntry(index, { reimbursementAmount: Number(e.target.value || 0) })}
                              placeholder="0.00"
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Receipt / proof</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.receiptReference || ''}
                              onChange={e => updatePayoutEntry(index, { receiptReference: e.target.value })}
                              placeholder="Receipt link or note"
                            />
                          </label>
                          <label className="block">
                            <span className="crm-label">Payout method</span>
                            <select
                              className="crm-input mt-1"
                              value={entry.paymentMethod || 'interac'}
                              onChange={e => updatePayoutEntry(index, { paymentMethod: e.target.value as CrewPayoutMethod })}
                            >
                              {(Object.keys(CREW_PAYOUT_METHOD_LABELS) as CrewPayoutMethod[]).map(method => (
                                <option key={method} value={method}>{CREW_PAYOUT_METHOD_LABELS[method]}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block md:col-span-2">
                            <span className="crm-label">Payout destination / note</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.payoutDestination || ''}
                              onChange={e => updatePayoutEntry(index, { payoutDestination: e.target.value })}
                              placeholder="Interac email, Stripe account note, or payout instructions"
                            />
                          </label>
                          <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Crew dispatch link</div>
                                <div className="truncate text-xs text-slate-500">{getCrewDispatchUrl(entry) || 'Save to generate link'}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyCrewDispatchLink(index)}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#071421] hover:bg-slate-50"
                              >
                                Copy link
                              </button>
                            </div>
                          </div>
                          <label className="block md:col-span-2">
                            <span className="crm-label">Reimbursement note</span>
                            <input
                              className="crm-input mt-1"
                              value={entry.reimbursementNote || ''}
                              onChange={e => updatePayoutEntry(index, { reimbursementNote: e.target.value })}
                              placeholder="Gas, food, parking, supplies..."
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <span className="text-slate-500">
                            Labor: <span className="font-semibold text-[#071421]">{formatMoney(entry.laborPay || 0)}</span>
                            {entry.reimbursementAmount ? <> · Reimb.: <span className="font-semibold text-[#071421]">{formatMoney(entry.reimbursementAmount)}</span></> : null}
                          </span>
                          <span className="font-semibold text-[#071421]">Total payout: {formatMoney(totalPay)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {truckRequired ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="crm-label">Reservation Status</span>
                      <select className="crm-input mt-1" value={truckStatus} onChange={e => setTruckStatus(e.target.value as TruckReservationStatus)}>
                        {(['needs_booking', 'booking_in_progress', 'reserved', 'issue'] as TruckReservationStatus[]).map(status => (
                          <option key={status} value={status}>{TRUCK_RESERVATION_STATUS_LABELS[status]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="crm-label">Vendor</span>
                      <select className="crm-input mt-1" value={truckVendor} onChange={e => setTruckVendor(e.target.value as TruckVendor)}>
                        {(Object.keys(TRUCK_VENDOR_LABELS) as TruckVendor[]).map(vendor => (
                          <option key={vendor} value={vendor}>{TRUCK_VENDOR_LABELS[vendor]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="crm-label">Truck Size</span>
                      <input className="crm-input mt-1" value={truckSize} onChange={e => setTruckSize(e.target.value)} placeholder="26ft" />
                    </label>
                    <label className="block">
                      <span className="crm-label">Pickup Time</span>
                      <input type="datetime-local" className="crm-input mt-1" value={pickupTime} onChange={e => setPickupTime(e.target.value)} />
                    </label>
                  </div>

                  <label className="block">
                    <span className="crm-label">Pickup Location</span>
                    <input className="crm-input mt-1" value={pickupLocation} onChange={e => setPickupLocation(e.target.value)} placeholder="Nearest U-Haul with the quoted truck count" />
                  </label>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="crm-label">Return Location</span>
                      <input className="crm-input mt-1" value={returnLocation} onChange={e => setReturnLocation(e.target.value)} placeholder="Return address / branch" />
                    </label>
                    <label className="block">
                      <span className="crm-label">Reservation #</span>
                      <input className="crm-input mt-1" value={reservationNumber} onChange={e => setReservationNumber(e.target.value)} placeholder="Vendor confirmation number" />
                    </label>
                  </div>

                  <label className="block">
                    <span className="crm-label">Reservation Notes</span>
                    <textarea
                      className="crm-input mt-1 h-20 resize-none"
                      value={reservationNotes}
                      onChange={e => setReservationNotes(e.target.value)}
                      placeholder="Login used, pickup instructions, upsells skipped, or issue notes"
                    />
                  </label>
                </>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  No truck requirement is stored on the quote for this job yet.
                </div>
              )}

              <div>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Pre-move dispatch checklist</div>
                <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${
                  accessAssessment.status === 'clear'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : accessAssessment.status === 'high_risk'
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{accessAssessment.label}</span>
                    <span className="text-xs font-semibold">{accessAssessment.extraMinutes > 0 ? `+${accessAssessment.extraMinutes} min` : 'No added access time'}</span>
                  </div>
                  <div className="mt-1 text-xs">{accessAssessment.summary}</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={crewRolePlanReady} readOnly className="h-4 w-4 accent-emerald-600" />
                    Crew roles assigned
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={truckRequired ? truckStatus === 'reserved' : true} readOnly className="h-4 w-4 accent-emerald-600" />
                    Truck reserved
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={accessConfirmed || accessAssessment.accessAutoClear} onChange={e => setAccessConfirmed(e.target.checked)} disabled={accessAssessment.accessAutoClear} className="h-4 w-4 accent-[#071421] disabled:opacity-70" />
                    {accessAssessment.accessAutoClear ? 'Access auto-clear' : 'Access reviewed'}
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={parkingConfirmed || accessAssessment.parkingAutoClear} onChange={e => setParkingConfirmed(e.target.checked)} disabled={accessAssessment.parkingAutoClear} className="h-4 w-4 accent-[#071421] disabled:opacity-70" />
                    {accessAssessment.parkingAutoClear ? 'Parking auto-clear' : 'Parking reviewed'}
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={toolsReady} onChange={e => setToolsReady(e.target.checked)} className="h-4 w-4 accent-[#071421]" />
                    Equipment / materials ready
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input type="checkbox" checked={jobPacketReady} onChange={e => setJobPacketReady(e.target.checked)} className="h-4 w-4 accent-[#071421]" />
                    Crew briefing ready
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 sm:col-span-2">
                    <input type="checkbox" checked={finalWalkthroughComplete} onChange={e => setFinalWalkthroughComplete(e.target.checked)} className="h-4 w-4 accent-[#071421]" />
                    Final walkthrough complete
                  </label>
                </div>
              </div>
            </div>
          </div>

          {message && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {message}
            </div>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Cancel</button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="flex-1 rounded-xl bg-[#071421] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {busy ? 'Saving...' : 'Save Pre-Move Checklist'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
