import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { syncRecentSalesFromListings } from '@/lib/server/recent-sales-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYNC_SECRET_SHA256 = '90b8e7432e1ebe0db438b8f4cf7007ac524f278193b6dddf56e3b86b1280e1eb'

function hasValidSyncSecret(request: Request) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const actual = Buffer.from(createHash('sha256').update(supplied).digest('hex'))
  const expected = Buffer.from(SYNC_SECRET_SHA256)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function run(request: Request) {
  if (!isAuthorizedCronRequest(request) && !hasValidSyncSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncRecentSalesFromListings()) })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: 'Recent sales sync failed', details }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
