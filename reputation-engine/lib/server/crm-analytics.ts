import {
  LOST_REASONS,
  CRM_LEAD_SOURCES,
  SALES_BRANCHES,
  formatDate,
  getLeadAssignedRepKey,
  getLeadAssignedRepName,
  getLeadSourceLabel,
  isBookedLikeStage,
} from '../sales'
import { BRANCH_CAPACITY_ESTIMATES, computeBranchCapacitySnapshot } from '../operations-capacity'
import type { CRMLead, CRMQuote, FollowUpLog } from '../types'
import { readEnv } from './runtime'
import { classifyServiceLine, type ServiceCategory } from '../service-profitability'

export type AnalyticsRange = 'week' | 'month' | 'ytd'

export type AnalyticsFilters = {
  range: AnalyticsRange
  rep?: string
  source?: string
  branch?: string
  dateFrom: string
  dateTo: string
}

export type CRMAnalyticsSnapshot = ReturnType<typeof buildCRMAnalyticsSnapshot>

type TrendBucket = {
  label: string
  leads: number
  bookings: number
  revenue: number
}

function toDateOnly(value?: string | null) {
  return (value || '').slice(0, 10)
}

function startOfToday() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function startOfWeek(date = new Date()) {
  const base = new Date(date)
  const day = base.getDay()
  const diff = day === 0 ? -6 : 1 - day
  base.setDate(base.getDate() + diff)
  return base.toISOString().slice(0, 10)
}

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10)
}

function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1).toISOString().slice(0, 10)
}

export function resolveAnalyticsFilters(searchParams: URLSearchParams) {
  const range = (searchParams.get('range') || 'month') as AnalyticsRange
  const today = startOfToday()
  const dateFrom =
    searchParams.get('dateFrom') ||
    (range === 'week' ? startOfWeek() : range === 'ytd' ? startOfYear() : startOfMonth())
  const dateTo = searchParams.get('dateTo') || today

  return {
    range: range === 'week' || range === 'ytd' ? range : 'month',
    rep: searchParams.get('rep') || undefined,
    source: searchParams.get('source') || undefined,
    branch: searchParams.get('branch') || undefined,
    dateFrom,
    dateTo,
  } satisfies AnalyticsFilters
}

function isWithinRange(dateStr: string | undefined, dateFrom: string, dateTo: string) {
  if (!dateStr) return false
  const date = toDateOnly(dateStr)
  return date >= dateFrom && date <= dateTo
}

function matchesLeadFilters(lead: CRMLead, filters: AnalyticsFilters) {
  if (filters.source && lead.source !== filters.source) return false
  if (filters.branch && lead.branch !== filters.branch) return false
  if (filters.rep && getLeadAssignedRepKey(lead) !== filters.rep) return false
  return true
}

function buildTrendBuckets(filters: AnalyticsFilters) {
  const buckets: TrendBucket[] = []
  let cursor = filters.dateFrom
  while (cursor <= filters.dateTo) {
    buckets.push({
      label: filters.range === 'ytd'
        ? new Date(`${cursor}T12:00:00`).toLocaleDateString('en-CA', { month: 'short' })
        : formatDate(cursor).replace(',', ''),
      leads: 0,
      bookings: 0,
      revenue: 0,
    })
    cursor = filters.range === 'ytd'
      ? new Date(new Date(`${cursor}T12:00:00`).getFullYear(), new Date(`${cursor}T12:00:00`).getMonth() + 1, 1).toISOString().slice(0, 10)
      : addDays(cursor, 1)
  }
  return buckets
}

function trendBucketIndex(dateStr: string | undefined, filters: AnalyticsFilters) {
  if (!dateStr || !isWithinRange(dateStr, filters.dateFrom, filters.dateTo)) return -1
  if (filters.range === 'ytd') {
    const monthStart = toDateOnly(dateStr).slice(0, 7)
    return buildTrendBuckets(filters).findIndex(bucket => bucket.label === new Date(`${monthStart}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'short' }))
  }
  const diff = Math.round((new Date(`${toDateOnly(dateStr)}T12:00:00`).getTime() - new Date(`${filters.dateFrom}T12:00:00`).getTime()) / 86_400_000)
  return diff >= 0 ? diff : -1
}

function getQuoteForLead(quotesByLead: Map<string, CRMQuote[]>, leadId: string) {
  const list = quotesByLead.get(leadId) || []
  return (
    list.find(quote => quote.status === 'accepted' || quote.status === 'invoiced') ||
    list.find(quote => quote.status === 'viewed' || quote.status === 'sent') ||
    list[0] ||
    null
  )
}

function monthlyRevenueTarget() {
  const raw = Number(readEnv('SALES_MONTHLY_REVENUE_TARGET') || 0)
  return raw > 0 ? raw : 100000
}

function normalizeReasonLabel(reason?: string) {
  if (!reason) return 'Unspecified'
  return LOST_REASONS.find(item => item.id === reason)?.label || reason.replace(/_/g, ' ')
}

export function buildCRMAnalyticsSnapshot(
  leads: CRMLead[],
  quotes: CRMQuote[],
  followUps: FollowUpLog[],
  filters: AnalyticsFilters
) {
  const scopedLeads = leads.filter(lead => matchesLeadFilters(lead, filters))
  const scopedLeadIds = new Set(scopedLeads.map(lead => lead.id))
  const quotesByLead = new Map<string, CRMQuote[]>()

  for (const quote of quotes) {
    if (!quote.leadId || !scopedLeadIds.has(quote.leadId)) continue
    const list = quotesByLead.get(quote.leadId) || []
    list.push(quote)
    quotesByLead.set(quote.leadId, list)
  }

  const leadsReceived = scopedLeads.filter(lead => isWithinRange(lead.createdAt, filters.dateFrom, filters.dateTo))
  const bookedLeads = scopedLeads.filter(lead => isBookedLikeStage(lead.stage) && isWithinRange(lead.bookedAt || getQuoteForLead(quotesByLead, lead.id)?.acceptedAt, filters.dateFrom, filters.dateTo))
  const tentativeLeads = scopedLeads.filter(lead => lead.stage === 'tentative' && isWithinRange(lead.createdAt, filters.dateFrom, filters.dateTo))
  const reservationLeads = scopedLeads.filter(lead =>
    Boolean(lead.tentativeReservedAt && isWithinRange(lead.tentativeReservedAt, filters.dateFrom, filters.dateTo))
  )
  const reservationStatusCounts = reservationLeads.reduce<Record<string, number>>((counts, lead) => {
    const status = lead.tentativeReservationStatus || 'unknown'
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  const reservationReasonCounts = reservationLeads.reduce<Record<string, number>>((counts, lead) => {
    const reason = lead.tentativeReason || 'unspecified'
    counts[reason] = (counts[reason] || 0) + 1
    return counts
  }, {})
  const lostLeads = scopedLeads.filter(lead => lead.stage === 'lost' && isWithinRange(lead.lostAt || lead.createdAt, filters.dateFrom, filters.dateTo))
  const quotesInRange = quotes.filter(quote => quote.leadId && scopedLeadIds.has(quote.leadId) && isWithinRange(quote.createdAt, filters.dateFrom, filters.dateTo))
  const followUpsInRange = followUps.filter(entry => entry.leadId && scopedLeadIds.has(entry.leadId) && isWithinRange(entry.date || entry.createdAt, filters.dateFrom, filters.dateTo))
  const trend = buildTrendBuckets(filters)

  for (const lead of leadsReceived) {
    const index = trendBucketIndex(lead.createdAt, filters)
    if (index >= 0) trend[index].leads += 1
  }

  let confirmedRevenue = 0
  for (const lead of bookedLeads) {
    const bookingDate = lead.bookedAt || getQuoteForLead(quotesByLead, lead.id)?.acceptedAt
    const index = trendBucketIndex(bookingDate, filters)
    const bestQuote = getQuoteForLead(quotesByLead, lead.id)
    const total = Number(bestQuote?.total || 0)
    confirmedRevenue += total
    if (index >= 0) {
      trend[index].bookings += 1
      trend[index].revenue += total
    }
  }

  const averageQuoteValue =
    quotesInRange.length > 0
      ? Math.round(quotesInRange.reduce((sum, quote) => sum + Number(quote.total || 0), 0) / quotesInRange.length)
      : 0
  const serviceMix = new Map<ServiceCategory, {
    quoteIds: Set<string>
    bookedQuoteIds: Set<string>
    quotedRevenue: number
    bookedRevenue: number
  }>()
  for (const quote of quotesInRange) {
    const booked = quote.status === 'accepted' || quote.status === 'invoiced'
    for (const line of quote.lineItems || []) {
      const category = classifyServiceLine(line.description || '')
      const current = serviceMix.get(category) || {
        quoteIds: new Set<string>(),
        bookedQuoteIds: new Set<string>(),
        quotedRevenue: 0,
        bookedRevenue: 0,
      }
      current.quoteIds.add(quote.id)
      current.quotedRevenue += Number(line.amount || 0)
      if (booked) {
        current.bookedQuoteIds.add(quote.id)
        current.bookedRevenue += Number(line.amount || 0)
      }
      serviceMix.set(category, current)
    }
  }

  const lostReasonCounts: Record<string, number> = {}
  for (const lead of lostLeads) {
    const reason = lead.lostReason || 'unspecified'
    lostReasonCounts[reason] = (lostReasonCounts[reason] || 0) + 1
  }

  const followUpEligible = leadsReceived.filter(lead => lead.stage !== 'lost')
  const followUpCompliant = followUpEligible.filter(lead => {
    const responseAt = lead.firstResponseAt || lead.lastHumanOutboundAt
    if (!responseAt || !lead.createdAt) return false
    const diffHours = (new Date(responseAt).getTime() - new Date(lead.createdAt).getTime()) / 3_600_000
    return diffHours >= 0 && diffHours <= 24
  }).length
  const followUpComplianceRate = followUpEligible.length > 0
    ? Math.round((followUpCompliant / followUpEligible.length) * 100)
    : 100

  const branchOptions = Array.from(
    new Set(scopedLeads.map(lead => lead.branch).filter(Boolean))
  ).map(branch => ({
    id: branch as string,
    label: (branch as string).replace(/^./, char => char.toUpperCase()),
  }))

  const repOptions = Array.from(
    new Map(
      scopedLeads
        .map(lead => [getLeadAssignedRepKey(lead), getLeadAssignedRepName(lead)] as const)
        .filter(([id, name]) => !!id && !!name)
    )
  ).map(([id, name]) => ({ id: id as string, label: name as string }))

  const sourceOptions = CRM_LEAD_SOURCES
    .filter(source => scopedLeads.some(lead => lead.source === source.id))
    .map(source => ({ id: source.id, label: source.label }))

  const sourceCounts = scopedLeads.reduce<Record<string, number>>((counts, lead) => {
    if (!lead.source) return counts
    counts[lead.source] = (counts[lead.source] || 0) + 1
    return counts
  }, {})

  const next30Days = Array.from({ length: 30 }, (_, index) => addDays(startOfToday(), index))
  const futureBookedJobs = scopedLeads
    .filter(lead => isBookedLikeStage(lead.stage))
    .map(lead => ({
      lead,
      quote: getQuoteForLead(quotesByLead, lead.id),
    }))
    .filter(job => {
      const moveDate = job.quote?.moveDate || job.lead.moveDate
      return !!moveDate && moveDate >= startOfToday() && moveDate <= next30Days[next30Days.length - 1]
    })

  const utilizationBranchIds = filters.branch
    ? [filters.branch]
    : Object.keys(BRANCH_CAPACITY_ESTIMATES)

  const truckUtilizationDays = next30Days.flatMap(date =>
    utilizationBranchIds.map(branch => {
      const snapshot = computeBranchCapacitySnapshot(futureBookedJobs, branch as CRMLead['branch'], date)
      return {
        date,
        branch,
        ...snapshot,
      }
    })
  ).filter(day => day.status === 'ready' && day.jobsBooked > 0)

  const monthlyTarget = monthlyRevenueTarget()
  const monthlyProgressPct = monthlyTarget > 0 ? Math.min(100, Math.round((confirmedRevenue / monthlyTarget) * 100)) : 0

  return {
    appliedFilters: filters,
    totals: {
      leadsReceived: leadsReceived.length,
      confirmedBookings: bookedLeads.length,
      confirmedRevenue,
      tentativeReservations: tentativeLeads.length,
      lostLeads: lostLeads.length,
      conversionRate: leadsReceived.length > 0 ? Math.round((bookedLeads.length / leadsReceived.length) * 100) : 0,
      averageQuoteValue,
      followUpComplianceRate,
      followUpCompliant,
      followUpEligible: followUpEligible.length,
      monthlyTarget,
      monthlyProgressPct,
    },
    trend,
    reservationFunnel: {
      total: reservationLeads.length,
      active: reservationStatusCounts.active || 0,
      converted: reservationStatusCounts.converted || 0,
      released: reservationStatusCounts.released || 0,
      expired: reservationStatusCounts.expired || 0,
      conversionRate: reservationLeads.length > 0
        ? Math.round(((reservationStatusCounts.converted || 0) / reservationLeads.length) * 100)
        : 0,
      reasons: Object.entries(reservationReasonCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([reason, count]) => ({ reason, label: reason.replace(/_/g, ' '), count })),
    },
    serviceBreakdown: [...serviceMix.entries()]
      .map(([category, values]) => ({
        category,
        label: category.replace(/^./, char => char.toUpperCase()),
        quoteCount: values.quoteIds.size,
        bookedCount: values.bookedQuoteIds.size,
        quotedRevenue: Math.round(values.quotedRevenue * 100) / 100,
        bookedRevenue: Math.round(values.bookedRevenue * 100) / 100,
        conversionRate: values.quoteIds.size > 0 ? Math.round((values.bookedQuoteIds.size / values.quoteIds.size) * 100) : 0,
      }))
      .sort((a, b) => b.quotedRevenue - a.quotedRevenue),
    sourceBreakdown: Object.entries(sourceCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => ({
        source,
        label: getLeadSourceLabel(source),
        count,
      })),
    lostReasons: Object.entries(lostReasonCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => ({
        reason,
        label: normalizeReasonLabel(reason),
        count,
      })),
    activityBreakdown: Object.entries(
      followUpsInRange.reduce<Record<string, number>>((counts, entry) => {
        counts[entry.type] = (counts[entry.type] || 0) + 1
        return counts
      }, {})
    )
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count })),
    truckUtilizationDays,
    branchBreakdown: SALES_BRANCHES.map(b => {
      const branchLeads = scopedLeads.filter(l => l.branch === b.id)
      const received = branchLeads.filter(l => isWithinRange(l.createdAt, filters.dateFrom, filters.dateTo)).length
      const booked = branchLeads.filter(l => isBookedLikeStage(l.stage) && isWithinRange(l.bookedAt || getQuoteForLead(quotesByLead, l.id)?.acceptedAt, filters.dateFrom, filters.dateTo)).length
      const lost = branchLeads.filter(l => l.stage === 'lost' && isWithinRange(l.lostAt || l.createdAt, filters.dateFrom, filters.dateTo)).length
      return { branch: b.id, label: b.label, received, booked, lost, conversionRate: received > 0 ? Math.round((booked / received) * 100) : 0 }
    }).filter(b => b.received > 0 || b.booked > 0).sort((a, b) => b.received - a.received),
    filters: {
      repOptions,
      sourceOptions,
      branchOptions,
    },
  }
}
