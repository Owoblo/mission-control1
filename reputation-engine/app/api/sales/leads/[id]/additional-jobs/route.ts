import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildAdditionalJob, type AdditionalJobInput } from '@/lib/additional-job'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLead, insertAdditionalSalesJob, listAdditionalSalesJobs } from '@/lib/server/sales-repository'

type Context = { params: Promise<{ id: string }> }
async function authorize(context: Context) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) throw new Error('Unauthorized')
  const { id } = await context.params
  const lead = await getSalesLead(id)
  if (!lead || !leadMatchesSessionBranch(lead, session)) throw new Error('Not found')
  return lead
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Additional job failed'
  return NextResponse.json({ error: message }, { status: message === 'Unauthorized' ? 401 : message === 'Not found' ? 404 : 400 })
}
export async function GET(_: Request, context: Context) {
  try {
    const parent = await authorize(context)
    const jobs = await listAdditionalSalesJobs(parent.id)
    return NextResponse.json({ jobs: jobs.map(job => ({ id: job.id, label: job.additionalJobLabel, kind: job.additionalJobKind, stage: job.stage })) })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const parent = await authorize(context)
    const input = await request.json() as AdditionalJobInput
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '')) throw new Error('A valid request identifier is required.')
    if (input.moveDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.moveDate)) throw new Error('Use a valid move date.')
    const id = `lead_add_${createHash('sha256').update(`${parent.id}:${input.requestId}`).digest('hex').slice(0, 24)}`
    const lead = await insertAdditionalSalesJob(buildAdditionalJob(parent, input, id))
    return NextResponse.json({ lead })
  } catch (error) { return failure(error) }
}
