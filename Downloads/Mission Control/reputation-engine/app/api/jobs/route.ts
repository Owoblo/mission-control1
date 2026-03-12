import { NextResponse } from 'next/server'
import { listJobs, saveJobRecord } from '@/lib/server/repository'
import { normalizeJob } from '@/lib/store'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await listJobs())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Job
    const job = normalizeJob(payload)
    return NextResponse.json(await saveJobRecord(job))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
