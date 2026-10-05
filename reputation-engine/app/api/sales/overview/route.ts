import { scopeDashboard } from '@/lib/server/dashboard-scope'
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
let overviewRefresh: Promise<Awaited<ReturnType<typeof getSalesOverview>>> | null = null

async function getCachedSalesOverview() {
  const now = Date.now()
  if (overviewCache && overviewCache.expiresAt > now) return overviewCache.payload
  if (!overviewRefresh) {
    overviewRefresh = getSalesOverview()
      .then(payload => {
        overviewCache = { payload, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS }
        return payload
      })
      .finally(() => { overviewRefresh = null })
  }
  return overviewRefresh
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  try {
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (new URL(request.url).searchParams.get('mode') === 'search') {
      const leads = await listSalesLeadSearchSnapshots()
      return NextResponse.json({ leads: leads.filter(lead => leadMatchesSessionBranch(lead, session)) })
    }

    const overview = new URL(request.url).searchParams.get('fresh') === '1'
      ? await getSalesOverview()
      : await getCachedSalesOverview()

    if (isBranchScopedManager(session)) {
      const { leads, quotes, followUps } = scopeDashboard(overview, session)
      const clientIds = new Set(quotes.map(quote => quote.clientId).filter(Boolean))
      const clients = overview.clients.filter(client => clientIds.has(client.id))
      return NextResponse.json({ leads, quotes, clients, followUps, summary: buildSalesSummary(leads, quotes) })
    }

    return NextResponse.json(overview)
  } catch (error) {
    console.error('[sales-overview] Live CRM read failed', error)
    if (overviewCache && canAccessSalesWorkspace(session) && !isBranchScopedManager(session)) {
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
