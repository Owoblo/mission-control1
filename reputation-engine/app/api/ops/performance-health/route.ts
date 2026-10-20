import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getPerformanceHealth } from '@/lib/server/performance-health'
import { getSessionUser } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  const session = await getSessionUser()
  return session?.role === 'owner' || (session?.role === 'manager' && !session.branch)
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let report
  try { report = await getPerformanceHealth() } catch {
    return NextResponse.json({ status: 'fail', generatedAt: new Date().toISOString(), error: 'Database health checks could not complete.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  return NextResponse.json(report, {
    status: report.status === 'fail' ? 503 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
