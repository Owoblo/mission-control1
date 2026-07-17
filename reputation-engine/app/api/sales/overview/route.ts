import { NextResponse } from 'next/server'
import { getSalesOverview, listSalesLeadSearchSnapshots } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

const OVERVIEW_CACHE_TTL_MS = 10_000
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
      return NextResponse.json({ leads })
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

    return NextResponse.json(overview)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sales overview' },
      { status: 500 }
    )
  }
}
