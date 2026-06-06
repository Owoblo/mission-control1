import { NextResponse } from 'next/server'
import { isAutomationRequestAuthorized } from '@/lib/server/automation-auth'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { processDueAutomationJobs } from '@/lib/server/sales-automation'

async function runProcessor(limit = 25) {
  const jobs = await processDueAutomationJobs(limit)
  return NextResponse.json({ ok: true, count: jobs.length, jobs })
}

export async function POST(request: Request) {
  if (!(await isAutomationRequestAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number }
    return await runProcessor(body.limit || 25)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process automation jobs' },
      { status: 400 }
    )
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return await runProcessor(25)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process automation jobs' },
      { status: 400 }
    )
  }
}
