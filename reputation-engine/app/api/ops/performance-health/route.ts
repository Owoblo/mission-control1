import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getPerformanceHealth } from '@/lib/server/performance-health'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  const session = await getSessionUser()
  return !!session && canAccessSalesWorkspace(session)
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const report = await getPerformanceHealth()
  return NextResponse.json(report, {
    status: report.status === 'fail' ? 503 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
