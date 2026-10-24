import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { actOnNextStep, assertNextStepAccess, loadNextSteps, NextStepError } from '@/lib/server/relationship-next-step'
import { receiptDelivery } from '@/lib/relationship-next-step'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const headers = { 'Cache-Control': 'private, no-store' }
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof NextStepError ? error.message : 'Request evidence could not refresh. No clear status can be inferred.', coverage: { complete: false } }, { status: error instanceof NextStepError ? error.status : 503, headers })
}
export async function GET(request: Request) {
  try {
    const session = await getRequestSessionUser(request)
    const q = new URL(request.url).searchParams, contactId = q.get('contactId') ?? undefined
    assertNextStepAccess(session, contactId)
    const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 20)
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new NextStepError('Invalid pagination', 400)
    const data = await loadNextSteps(session!, contactId)
    const active = data.rows.filter(r => ['review', 'waiting', 'submitted'].includes(r.state)).sort((a,b) => Number(a.state !== 'review') - Number(b.state !== 'review') || a.requestedAt.localeCompare(b.requestedAt) || a.key.localeCompare(b.key))
    const rows = contactId ? [...active, ...data.rows.filter(r => !['review', 'waiting', 'submitted'].includes(r.state))] : active
    return NextResponse.json({ policyVersion: data.policyVersion, generatedAt: data.generatedAt, coverage: data.coverage,
      counts: Object.fromEntries(['review', 'waiting', 'submitted', 'fulfilled', 'reviewed', 'suppressed'].map(state => [state, data.rows.filter(r => r.state === state).length])),
      total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit),
      existingWork: contactId ? data.tasks.filter(t => ['partnership_address_fulfilment', 'partner_email_fulfilment', 'partnership_print_delivery', 'partnership_visit_fulfilment'].includes(t.category) && ['open', 'in_progress'].includes(t.status)).map(t => ({ id: t.id, title: t.title, category: t.category, dueAt: t.due_at, owner: t.owner_name })) : [],
      receipts: contactId ? data.touches.filter(t => receiptDelivery(t)).map(t => ({ id: t.id, channel: t.channel, at: t.created_at, excerpt: String(t.notes || '').slice(0, 350), delivery: receiptDelivery(t) })) : [],
    }, { headers })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    const session = await getRequestSessionUser(request)
    assertNextStepAccess(session)
    let body: Record<string, unknown>
    try { body = await request.json() } catch { throw new NextStepError('Invalid request', 400) }
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new NextStepError('Invalid request', 400)
    return NextResponse.json(await actOnNextStep(session!, body), { headers })
  } catch (error) { return failure(error) }
}
