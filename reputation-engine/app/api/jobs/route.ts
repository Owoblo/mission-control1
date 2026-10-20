import { NextResponse } from 'next/server'
import { listJobs, saveJobRecord, getJob } from '@/lib/server/repository'
import { getSessionUser } from '@/lib/server/session'
import { canUseJobs } from '@/lib/job-access'
import { jobAccessible } from '@/lib/server/job-access'
import { normalizeJob } from '@/lib/store'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getSessionUser()
    if (!canUseJobs(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const jobs = await listJobs()
    const allowed = await Promise.all(jobs.map(async job => await jobAccessible(session, job) ? job : null))
    return NextResponse.json(allowed.filter(Boolean))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canUseJobs(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const payload = (await request.json()) as Job
    const job = normalizeJob(payload)
    const current = await getJob(job.id)
    if ((current && !(await jobAccessible(session, current))) || !(await jobAccessible(session, job))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(await saveJobRecord(job))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
