import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { runTentativeReservationReconciliation } from '@/lib/server/tentative-reservation-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  const session = await getSessionUser()
  return !!session && canAccessSalesWorkspace(session)
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runTentativeReservationReconciliation())
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await runTentativeReservationReconciliation())
}
