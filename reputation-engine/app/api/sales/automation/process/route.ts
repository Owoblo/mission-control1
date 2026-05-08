import { NextResponse } from 'next/server'
import { isAutomationRequestAuthorized } from '@/lib/server/automation-auth'
import { processDueAutomationJobs } from '@/lib/server/sales-automation'

export async function POST(request: Request) {
  if (!(await isAutomationRequestAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number }
    const jobs = await processDueAutomationJobs(body.limit || 25)
    return NextResponse.json({ ok: true, count: jobs.length, jobs })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process automation jobs' },
      { status: 400 }
    )
  }
}
