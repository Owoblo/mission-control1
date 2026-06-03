import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { renderLeadFlowHealthEmail, runLeadFlowHealthCheck } from '@/lib/server/lead-flow-health'
import { getAppBaseUrl } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function hasSessionAccess() {
  const session = await getSessionUser()
  return !!session && canAccessSalesWorkspace(session)
}

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) {
    return true
  }

  return hasSessionAccess()
}

function buildSubject(status: 'ok' | 'warn' | 'fail') {
  return `Lead Flow Health ${status.toUpperCase()}`
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await runLeadFlowHealthCheck(getAppBaseUrl(new URL(request.url).origin))
  return NextResponse.json(report)
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await runLeadFlowHealthCheck(getAppBaseUrl(new URL(request.url).origin))
  await sendRepAlertEmail(buildSubject(report.status), renderLeadFlowHealthEmail(report))

  return NextResponse.json({ ok: report.status !== 'fail', emailed: true, report })
}
