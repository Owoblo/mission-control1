import { NextResponse } from 'next/server'
import { getSalesOverview, listSalesLeadSearchSnapshots } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { buildSalesSummary } from '@/lib/sales'
import { isBranchScopedManager, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'

// Prevent serverless refresh bursts from rebuilding the same database-heavy
// dashboard snapshot every few seconds.
const OVERVIEW_CACHE_TTL_MS = 60_000
let overviewCache: {
  expiresAt: number
  payload: Awaited<ReturnType<typeof getSalesOverview>>
} | null = null

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (new URL(request.url).searchParams.get('mode') === 'search') {
      const leads = await listSalesLeadSearchSnapshots()
      return NextResponse.json({ leads: leads.filter(lead => leadMatchesSessionBranch(lead, session)) })
    }

    const now = Date.now()
    const overview = overviewCache && overviewCache.expiresAt > now
      ? overviewCache.payload
      : await getSalesOverview()

    if (!overviewCache || overviewCache.payload !== overview) {
      overviewCache = {
        expiresAt: now + OVERVIEW_CACHE_TTL_MS,
        payload: overview,
      }
    }

    if (isBranchScopedManager(session)) {
      const leads = overview.leads.filter(lead => leadMatchesSessionBranch(lead, session))
      const leadIds = new Set(leads.map(lead => lead.id))
      const quotes = overview.quotes.filter(quote => Boolean(quote.leadId && leadIds.has(quote.leadId)))
      const quoteIds = new Set(quotes.map(quote => quote.id))
      const clientIds = new Set(quotes.map(quote => quote.clientId).filter(Boolean))
      const clients = overview.clients.filter(client => clientIds.has(client.id))
      const followUps = overview.followUps.filter(log =>
        Boolean((log.leadId && leadIds.has(log.leadId)) || (log.quoteId && quoteIds.has(log.quoteId)))
      )
      return NextResponse.json({ leads, quotes, clients, followUps, summary: buildSalesSummary(leads, quotes) })
    }

    return NextResponse.json(overview)
  } catch (error) {
    console.error('[sales-overview] Live CRM read failed', error)
    if (overviewCache) {
      return NextResponse.json(
        { ...overviewCache.payload, stale: true, warning: 'Live data is temporarily unavailable.' },
        { headers: { 'X-Saturn-Data': 'stale', 'Retry-After': '5' } }
      )
    }
    return NextResponse.json(
      { error: 'CRM data is temporarily unavailable. Please retry.', retryable: true },
      { status: 503, headers: { 'Retry-After': '5' } }
    )
  }
}
