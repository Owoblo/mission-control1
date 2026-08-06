import { NextResponse } from 'next/server'
import { deleteJobRecord, getJob, saveJobRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'
import { normalizeJob } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const job = await getJob(params.id)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(job)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await deleteJobRecord(params.id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  try {
    if (!(await hasInternalSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const current = await getJob(params.id)
    if (!current) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const input = await request.json()
    return NextResponse.json(await saveJobRecord(normalizeJob({ ...current, ...input, id: current.id })))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
