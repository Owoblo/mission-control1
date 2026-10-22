import { NextResponse } from 'next/server'
import { captureMessage, flush } from '@sentry/nextjs'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getDatabaseHealth } from '@/lib/server/database-health'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(request: Request) {
  const cron = isAuthorizedCronRequest(request)
  if (!cron) {
    const session = await getSessionUser()
    if (!session || !canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  let report: Awaited<ReturnType<typeof getDatabaseHealth>>
  try { report = await getDatabaseHealth() } catch {
    report = { status: 'fail', generatedAt: new Date().toISOString(), checks: [] }
  }
  if (report.status === 'fail') {
    console.error(JSON.stringify({ event: 'crm_database_unavailable', ...report }))
    // Stable grouping, no credentials or customer rows; uses existing Sentry routing.
    if (cron) {
      captureMessage('CRM database reads unavailable', {
        level: 'error', fingerprint: ['crm-database-unavailable'],
        tags: { component: 'database-health' }, extra: { report },
      })
      await flush(2_000).catch(() => false)
    }
  }
  return NextResponse.json(report, {
    status: report.status === 'fail' ? 503 : 200,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
