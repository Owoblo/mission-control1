import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { reconcileRadarTasks } from '@/lib/server/follow-up-radar'
export const runtime = 'nodejs'
export const maxDuration = 300
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ ok: true, ...await reconcileRadarTasks() }) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Radar reconciliation failed.' }, { status: 500 }) }
}
