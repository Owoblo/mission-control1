import { createHash } from 'node:crypto'
import { completeCallback } from '@/lib/server/conversation-integrity'
import { NextResponse } from 'next/server'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesLeadForUpdate, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import type { CustomerPromise, PromiseChannel } from '@/lib/types'

const CHANNELS = new Set<PromiseChannel>(['call', 'sms', 'email', 'in_person', 'internal'])

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const current = await getSalesLeadForUpdate(params.id)
  const lead = current?.lead
  if (!lead || !canHandleLeadCommunications(session, lead)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const body = await request.json() as Partial<CustomerPromise> & { promiseId?: string; completionEvidence?: string }
  const now = new Date().toISOString()

  if (body.promiseId) {
    const evidence = body.completionEvidence?.trim()
    if (!evidence) return NextResponse.json({ error: 'Completion evidence is required.' }, { status: 400 })
    if (lead.callbackCommitment?.status === 'open' && body.promiseId === `promise_auto_${createHash('md5').update(lead.callbackCommitment.key).digest('hex')}`) {
      if (evidence.length < 12 || Date.parse(lead.callbackCommitment.notBefore) > Date.now()) return NextResponse.json({ error: 'Wait for the requested window and record the customer evidence.' }, { status: 409 })
      await completeCallback(lead, now, evidence)
      return NextResponse.json({ ok: true, lead: await getSalesLead(params.id) })
    }
    let found = false
    const promises = (lead.promises || []).map(item => {
      if (item.id !== body.promiseId) return item
      found = true
      return { ...item, status: 'completed' as const, completedAt: now, completionEvidence: evidence }
    })
    if (!found) return NextResponse.json({ error: 'Promise not found' }, { status: 404 })
    return NextResponse.json({ ok: true, lead: await saveSalesLead({ ...lead, promises, lastTouchedAt: now, lastTouchedByUserId: session?.userId, lastTouchedByName: session?.name }, current!.updatedAt) })
  }

  const action = body.action?.trim()
  const reason = body.reason?.trim()
  const intendedOutcome = body.intendedOutcome?.trim()
  const dueAt = body.dueAt?.trim()
  const channel = body.channel && CHANNELS.has(body.channel) ? body.channel : null
  if (!action || !reason || !intendedOutcome || !dueAt || !channel) {
    return NextResponse.json({ error: 'Action, reason, channel, timing, and intended outcome are required.' }, { status: 400 })
  }
  const promise: CustomerPromise = {
    id: `promise_${crypto.randomUUID()}`, action, reason, intendedOutcome, dueAt, channel,
    ownerUserId: session?.userId, ownerName: session?.name || 'Saturn Star team', status: 'open', createdAt: now,
  }
  const saved = await saveSalesLead({ ...lead, promises: [...(lead.promises || []), promise], lastTouchedAt: now, lastTouchedByUserId: session?.userId, lastTouchedByName: session?.name }, current!.updatedAt)
  return NextResponse.json({ ok: true, lead: saved, promise })
}
