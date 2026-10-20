import { NextResponse } from 'next/server'
import { deleteJobRecord, getJob, saveJobRecord } from '@/lib/server/repository'
import { getSessionUser } from '@/lib/server/session'
import { canUseJobs } from '@/lib/job-access'
import { jobAccessible } from '@/lib/server/job-access'
import { normalizeJob } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canUseJobs(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const job = await getJob(params.id)
    if (!job || !(await jobAccessible(session, job))) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(job)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canUseJobs(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const current = await getJob(params.id)
    if (!current || !(await jobAccessible(session, current)) || !['owner', 'manager'].includes(session?.role || '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await deleteJobRecord(params.id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    const session = await getSessionUser()
    if (!canUseJobs(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    const current = await getJob(params.id)
    if (!current || !(await jobAccessible(session, current))) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const input = await request.json()
    const next = normalizeJob({ ...current, ...input, id: current.id })
    if (!(await jobAccessible(session, next))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json(await saveJobRecord(next))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
