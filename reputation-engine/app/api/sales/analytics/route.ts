import { NextResponse } from 'next/server'
import { formatMoney } from '@/lib/sales'
import { buildCRMAnalyticsSnapshot, resolveAnalyticsFilters } from '@/lib/server/crm-analytics'
import { listFollowUpLogs, listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { isBranchScopedManager, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'

function toCsv(snapshot: ReturnType<typeof buildCRMAnalyticsSnapshot>) {
  const lines = [
    ['Metric', 'Value'],
    ['Leads received', String(snapshot.totals.leadsReceived)],
    ['Confirmed bookings', String(snapshot.totals.confirmedBookings)],
    ['Confirmed revenue', formatMoney(snapshot.totals.confirmedRevenue)],
    ['Tentative reservations', String(snapshot.totals.tentativeReservations)],
    ['Lost leads', String(snapshot.totals.lostLeads)],
    ['Conversion rate', `${snapshot.totals.conversionRate}%`],
    ['Average quote value', formatMoney(snapshot.totals.averageQuoteValue)],
    ['Follow-up compliance', `${snapshot.totals.followUpComplianceRate}%`],
    ['Monthly target', formatMoney(snapshot.totals.monthlyTarget)],
    ['Monthly progress', `${snapshot.totals.monthlyProgressPct}%`],
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
  const [allLeads, allQuotes, allFollowUps] = await Promise.all([
    listSalesLeads().catch(() => []),
    listSalesQuotes().catch(() => []),
    listFollowUpLogs().catch(() => []),
  ])

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
      },
    })
  }

  return NextResponse.json(snapshot)
}
