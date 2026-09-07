import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { canAccessSalesWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { finishTimedResponse } from '@/lib/server/performance'
import { getSalesBranchCapacity } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import type { CRMLead } from '@/lib/types'

const BRANCHES = new Set<NonNullable<CRMLead['branch']>>(['windsor', 'waterloo', 'london', 'ottawa'])
const CAPACITY_CACHE_TTL_MS = 10_000
const capacityCache = new Map<string, {
  expiresAt: number
  payload: Awaited<ReturnType<typeof getSalesBranchCapacity>>
}>()
const capacityRefreshes = new Map<string, Promise<Awaited<ReturnType<typeof getSalesBranchCapacity>>>>()
const loadSharedBranchCapacity = unstable_cache(
  getSalesBranchCapacity,
  ['sales-branch-capacity-v1'],
  { revalidate: CAPACITY_CACHE_TTL_MS / 1000 },
)

async function getCachedBranchCapacity(branch: NonNullable<CRMLead['branch']>, date: string) {
  const key = `${branch}:${date}`
  const cached = capacityCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.payload
  const pending = capacityRefreshes.get(key)
  if (pending) return pending

  const refresh = loadSharedBranchCapacity(branch, date)
    .then(payload => {
      capacityCache.set(key, { payload, expiresAt: Date.now() + CAPACITY_CACHE_TTL_MS })
      return payload
    })
    .finally(() => { capacityRefreshes.delete(key) })
  capacityRefreshes.set(key, refresh)
  return refresh
}

export async function GET(request: Request) {
  const startedAt = performance.now()
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return finishTimedResponse(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), startedAt, 'sales_capacity')
  }
  const params = new URL(request.url).searchParams
  const branch = params.get('branch') as NonNullable<CRMLead['branch']> | null
  const date = params.get('date') || ''
  if (!branch || !BRANCHES.has(branch) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return finishTimedResponse(NextResponse.json({ error: 'Valid branch and date are required.' }, { status: 400 }), startedAt, 'sales_capacity')
  }
  if (!leadMatchesSessionBranch({ branch }, session)) {
    return finishTimedResponse(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), startedAt, 'sales_capacity')
  }
  try {
    return finishTimedResponse(NextResponse.json(await getCachedBranchCapacity(branch, date)), startedAt, 'sales_capacity')
  } catch (error) {
    console.error('[sales-capacity] Read failed', error)
    return finishTimedResponse(NextResponse.json({ error: 'Capacity is temporarily unavailable.' }, { status: 503 }), startedAt, 'sales_capacity')
  }
}
