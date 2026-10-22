import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { loadRelationshipIntelligence } from '@/lib/server/relationship-intelligence'
import { relationshipTasks, resolveNamedReferrer, RELATIONSHIP_POLICY } from '@/lib/relationship-development'
import { hasAcceptedOutboundEvidence } from '@/lib/relationship-state'
import { saveGeneratedTasks } from '@/lib/server/task-repository'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowed = (role?: string) => ['owner', 'manager', 'partnership_manager'].includes(role || '')

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || !allowed(session.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const query = new URL(request.url).searchParams
  const contactId = query.get('contactId') || undefined
  const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 100)
  if ((contactId && !uuid.test(contactId)) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) return NextResponse.json({ error: 'Invalid scope or pagination' }, { status: 400 })
  try {
    const data = await loadRelationshipIntelligence(session, contactId)
    const view = query.get('view') || 'actions'
    const common = { policyVersion: data.policyVersion, generatedAt: data.generatedAt, coverage: data.coverage, counts: data.context.counts,
      actionCounts: Object.fromEntries(['review', 'assigned', 'waiting', 'fulfilled', 'suppressed', 'graph_only'].map(d => [d, data.actions.filter(a => a.disposition === d).length])) }
    if (view === 'referrer') return NextResponse.json({ ...common, ...resolveNamedReferrer({ name: query.get('name') || '', company: query.get('company') || undefined, city: query.get('city') || undefined }, data.contacts) })
    if (view === 'history') {
      if (!contactId) return NextResponse.json({ error: 'Select a contact for history' }, { status: 400 })
      const rows = [
        ...data.history.touches.map(t => ({ source: 'market_touches', id: t.id, at: t.created_at, channel: t.channel, direction: t.direction, text: t.notes })),
        ...data.history.salesSms.map(t => ({ source: 'sms_messages', id: t.id, at: t.created_at, channel: 'sms', direction: t.direction, text: t.body, leadId: t.lead_id })),
        ...data.history.salesEmails.map(t => ({ source: 'crm_emails', id: t.id, at: t.data?.sentAt, channel: 'email', direction: t.data?.direction, text: t.data?.body, leadId: t.data?.leadId })),
        ...data.history.calls.map(t => ({ source: 'call_recordings', id: t.id, at: t.created_at, channel: 'call', text: t.summary, leadId: t.lead_id })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)))
      return NextResponse.json({ ...common, rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit, appointments: data.history.appointments })
    }
    if (view === 'learning') return NextResponse.json({ ...common, decisions: data.learning.decisions.slice(offset, offset + limit), corrections: data.learning.corrections.slice(offset, offset + limit), automaticPromotion: false })
    const rows = view === 'cohorts' ? data.cohorts : view === 'outcomes' ? data.outcomes : view === 'momentum' ? data.momentum.filter(m => m.score > 0).sort((a, b) => b.score - a.score) :
      view === 'constructive' ? data.context.constructiveQueue : data.actions.filter(a => !['suppressed', 'graph_only', 'fulfilled'].includes(a.disposition))
    return NextResponse.json({ ...common, rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit,
      contacts: data.contacts.filter(c => rows.slice(offset, offset + limit).some((r: any) => r.contactId === c.id)).map(c => ({ id: c.id, name: c.name, company: c.company, city: c.city })) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Intelligence unavailable' }, { status: 500 }) }
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session || !allowed(session.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  if (!uuid.test(body.contactId || '')) return NextResponse.json({ error: 'Valid contactId required' }, { status: 400 })
  try {
    const data = await loadRelationshipIntelligence(session, body.contactId)
    if (!data.contacts.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!data.coverage.complete) return NextResponse.json({ error: 'Incomplete evidence; no mutations performed', coverage: data.coverage }, { status: 503 })
    const { url, headers } = requireSupabaseEnv()
    const append = async (action: string, previous: unknown, next: unknown, metadata: Record<string, unknown>, key?: string) => {
      const hash = createHash('sha256').update(key || crypto.randomUUID()).digest('hex')
      const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
      const result = await fetch(`${url}/rest/v1/partner_activity_logs?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ id, contact_id: body.contactId, actor_user_id: session.userId || null, actor_name: session.name || null,
        action, previous_value: previous, next_value: next, metadata: { ...metadata, policy_version: RELATIONSHIP_POLICY } }) })
      if (!result.ok) throw Error('Could not persist relationship evidence')
    }
    if (body.action === 'create_task') {
      const action = data.actions.find(a => a.key === body.key)
      if (!action || action.disposition !== 'review') return NextResponse.json({ error: 'Action is no longer eligible for review-task creation' }, { status: 409 })
      await saveGeneratedTasks(relationshipTasks([action], data.contacts, data.generatedAt))
      await append('relationship.task_created', null, { key: action.key }, { evidence: action.evidence }, action.key)
    } else if (body.action === 'correct') {
      const decision = data.learning.decisions.find(d => d.id === body.decisionId)
      if (!decision || typeof body.correction !== 'string' || !body.correction.trim() || body.correction.length > 4000) return NextResponse.json({ error: 'Decision and correction required' }, { status: 400 })
      await append('relationship.ai_correction', decision.prediction, { correction: body.correction.trim() }, { decision_id: decision.id, input: decision.input, confidence: decision.prediction?.confidence,
        model_version: decision.model_version, prediction_policy_version: decision.policy_version, outcome_reference: null })
    } else if (body.action === 'fulfil') {
      const action = data.actions.find(a => a.key === body.key)
      const receipt = data.history.touches.find(t => t.id === body.receiptId)
      if (!action || !receipt || !['email', 'digital_card'].includes(action.kind) || !hasAcceptedOutboundEvidence(receipt) ||
          (action.kind === 'email' && receipt.channel !== 'email') || Date.parse(receipt.created_at) < Date.parse(action.sourceTime || '')) return NextResponse.json({ error: 'A matching accepted outbound receipt is required' }, { status: 400 })
      await append('relationship.fulfilment', null, { state: 'provider_accepted', deliveryConfirmed: false }, { request_touch_id: action.evidence[0].id, receipt_touch_id: receipt.id, kind: action.kind }, `fulfil:${action.key}:${receipt.id}`)
    } else if (body.action === 'assign_experiment') {
      const assignment = data.experiments[0]
      const response = await fetch(`${url}/rest/v1/crm_experiment_assignments?on_conflict=experiment_key,subject_type,subject_id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ experiment_key: assignment.experimentKey, subject_type: 'relationship', subject_id: body.contactId, variant: assignment.variant, context: { policy_version: RELATIONSHIP_POLICY, exposure: 'not_sent', market: data.contacts[0].city, category: data.contacts[0].industry } }) })
      if (!response.ok) throw Error('Could not persist experiment assignment')
    } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    return NextResponse.json({ ok: true, outboundSent: false })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Action failed' }, { status: 500 }) }
}
