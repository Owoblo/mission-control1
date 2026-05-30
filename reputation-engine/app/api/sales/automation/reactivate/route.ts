import { NextResponse } from 'next/server'
import { isAutomationRequestAuthorized } from '@/lib/server/automation-auth'
import { queueStaleLeadReactivation } from '@/lib/server/sales-automation'

export async function POST(request: Request) {
  if (!(await isAutomationRequestAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number
      daysInactive?: number
      dryRun?: boolean
    }

    const result = await queueStaleLeadReactivation({
      limit: body.limit,
      daysInactive: body.daysInactive,
      dryRun: body.dryRun,
    })

    return NextResponse.json({
      ok: true,
      candidates: result.candidates,
      queued: result.queued,
      candidateCount: result.candidates.length,
      queuedCount: result.queued.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue stale lead reactivation' },
      { status: 400 }
    )
  }
}
