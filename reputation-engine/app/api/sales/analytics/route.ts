import { NextResponse } from 'next/server'
import { formatMoney } from '@/lib/sales'
import { buildCRMAnalyticsSnapshot, resolveAnalyticsFilters } from '@/lib/server/crm-analytics'
import { listFollowUpLogsStrict, listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { isBranchScopedManager, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'

function toCsv(snapshot: ReturnType<typeof buildCRMAnalyticsSnapshot>) {
  const lines = [
    ['Metric', 'Value'],
    ['Leads received', String(snapshot.totals.leadsReceived)],
    ['Confirmed bookings', String(snapshot.totals.confirmedBookings)],
    ['Booked quote value (not collected revenue)', formatMoney(snapshot.totals.confirmedRevenue)],
    ['Tentative reservations', String(snapshot.totals.tentativeReservations)],
    ['Lost leads', String(snapshot.totals.lostLeads)],
    ['Lead cohort booking rate', `${snapshot.totals.cohortConversionRate}%`],
    ['Booking activity / new leads (different populations)', `${snapshot.totals.periodBookingActivityRate}%`],
    ['Average quote value', formatMoney(snapshot.totals.averageQuoteValue)],
    ['Follow-up compliance', `${snapshot.totals.followUpComplianceRate}%`],
    ['Monthly target', formatMoney(snapshot.totals.monthlyTarget)],
    ['Monthly progress', `${snapshot.totals.monthlyProgressPct}%`],
    [''],
    ['Metric definition', 'Date basis', 'Denominator', 'Exclusions', 'Source'],
    ...Object.values(snapshot.metricDefinitions).map(definition => [definition.label, definition.dateBasis, definition.denominator, definition.exclusions, definition.source]),
    [''],
    ['Source', 'Count'],
    ...snapshot.sourceBreakdown.map(item => [item.label, String(item.count)]),
    [''],
    ['Lost reason', 'Count'],
    ...snapshot.lostReasons.map(item => [item.label, String(item.count)]),
  ]

  return lines.map(row => row.join(',')).join('\n')
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || (session.role !== 'owner' && session.role !== 'manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const filters = resolveAnalyticsFilters(url.searchParams)
  if (isBranchScopedManager(session)) filters.branch = session.branch
  const [leadsResult, quotesResult, followUpsResult] = await Promise.allSettled([listSalesLeads(), listSalesQuotes(), listFollowUpLogsStrict()])
  const failedSources = [
    ...(leadsResult.status === 'rejected' ? ['leads'] : []),
    ...(quotesResult.status === 'rejected' ? ['quotes'] : []),
    ...(followUpsResult.status === 'rejected' ? ['followUps'] : []),
  ]
  if (failedSources.length) {
    return NextResponse.json({
      error: 'CRM analytics data is incomplete; retry after the affected data source is available.',
      code: 'ANALYTICS_SOURCE_READ_FAILED',
      failedSources,
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (leadsResult.status !== 'fulfilled' || quotesResult.status !== 'fulfilled' || followUpsResult.status !== 'fulfilled') {
    return NextResponse.json({ error: 'CRM analytics data is incomplete.', code: 'ANALYTICS_SOURCE_READ_FAILED' }, { status: 503 })
  }
  const allLeads = leadsResult.value
  const allQuotes = quotesResult.value
  const allFollowUps = followUpsResult.value

  const leads = allLeads.filter(lead => leadMatchesSessionBranch(lead, session))
  const allowedLeadIds = new Set(leads.map(lead => lead.id))
  const quotes = isBranchScopedManager(session)
    ? allQuotes.filter(quote => Boolean(quote.leadId && allowedLeadIds.has(quote.leadId)))
    : allQuotes
  const followUps = isBranchScopedManager(session)
    ? allFollowUps.filter(followUp => Boolean(followUp.leadId && allowedLeadIds.has(followUp.leadId)))
    : allFollowUps

  const snapshot = buildCRMAnalyticsSnapshot(leads, quotes, followUps, filters)

  if (url.searchParams.get('format') === 'csv') {
    return new Response(toCsv(snapshot), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="crm-analytics-${filters.dateFrom}-to-${filters.dateTo}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ ...snapshot, dataStatus: { complete: true, generatedAt: new Date().toISOString(), sources: ['leads', 'quotes', 'followUps'] } }, { headers: { 'Cache-Control': 'no-store' } })
}
