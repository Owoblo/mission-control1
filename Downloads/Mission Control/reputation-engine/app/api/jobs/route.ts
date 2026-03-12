import { NextResponse } from 'next/server'
import { listJobs, saveJobRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'
import { normalizeJob } from '@/lib/store'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(await listJobs())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = (await request.json()) as Job
    const job = normalizeJob(payload)
    return NextResponse.json(await saveJobRecord(job))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
