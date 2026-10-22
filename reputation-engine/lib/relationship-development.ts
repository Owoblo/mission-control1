import { projectRelationship, hasAcceptedOutboundEvidence, type RelationshipEvidenceRow as Row } from './relationship-state'
import { assignExperimentVariant } from './experiments'
import type { CRMTask } from './tasks'

export const RELATIONSHIP_POLICY = 'relationship-development-v1'
const DAY = 86400000
const requests: Record<string, string> = {
  package_requested: 'digital_card', postcard_requested: 'physical_card', media_requested: 'digital_card',
  digital_only: 'digital_card', asks_for_email: 'email', asks_pricing: 'pricing',
  meeting_requested: 'meeting', gives_time_window: 'meeting', secondary_contact_referral: 'introduction',
  partner_lead_received: 'sales_handoff', asks_references: 'references',
}
export type RelationshipAction = {
  key: string; contactId: string; kind: string; title: string; reason: string; priority: number
  evidence: { source: string; id: string }[]; disposition: 'review' | 'waiting' | 'assigned' | 'suppressed' | 'fulfilled' | 'graph_only'
  taskId?: string; dueAt?: string; owner?: string; sourceTime?: string
}

function reference(source: string, id: string) { return { source, id } }
function timestamp(value: unknown) { const time = Date.parse(String(value || '')); return Number.isFinite(time) ? time : 0 }
function recordedFulfilment(touch: Row, request: Row, kind: string) {
  const receipt = touch.metadata?.relationship_fulfilment
  return receipt?.request_touch_id === request.id && receipt?.kind === kind &&
    timestamp(touch.created_at) >= timestamp(request.created_at) && hasAcceptedOutboundEvidence(touch)
}

/** References existing records; never guesses completion from a later message. */
export function planRelationshipActions(input: {
  contact: Row; touches: Row[]; tasks: Row[]; referrals: Row[]; appointments?: Row[]; signals?: Row[]; now: string
}): RelationshipAction[] {
  const { contact, now } = input
  const touches = input.touches.filter(t => t.contact_id === contact.id)
  const tasks = input.tasks.filter(t => t.related_id === contact.id && ['partner', 'relationship'].includes(t.related_type))
  const relationship = projectRelationship({ ...input, touches, tasks })
  const suppressed = relationship.contactability === 'suppressed'
  const actions = new Map<string, RelationshipAction>()
  for (const touch of touches) {
    const kind = requests[touch.outcome_code]
    if (!kind || touch.direction !== 'inbound') continue
    const key = `relationship-request:${contact.id}:${touch.id}:${kind}`
    const existing = tasks.find(t => t.source_key === key)
    const uncertain = touch.metadata?.partnership_ai && (Number(touch.metadata.partnership_ai.confidence) < 0.85 || touch.metadata.partnership_ai.risk_flags?.length)
    const fulfilled = touches.some(t => recordedFulfilment(t, touch, kind)) || existing?.status === 'completed'
    const appointment = kind === 'meeting' ? input.appointments?.find(a => a.contact_id === contact.id && a.status === 'scheduled' && timestamp(a.created_at) >= timestamp(touch.created_at)) : undefined
    const legacyOpenTask = tasks.find(t => ['open', 'in_progress'].includes(t.status) && t.source_key !== key)
    const owner = existing?.owner_name || existing?.owner_user_id || legacyOpenTask?.owner_name || legacyOpenTask?.owner_user_id || contact.owner_name || contact.assigned_manager_user_id
    const dueAt = existing?.due_at || appointment?.scheduled_at
    actions.set(key, {
      key, contactId: contact.id, kind: uncertain ? 'ambiguity' : kind,
      title: `${uncertain ? 'Review' : 'Fulfil'} ${kind.replaceAll('_', ' ')} request`,
      reason: uncertain ? 'Recorded classification needs confirmation against the conversation.' : 'Explicit recorded request; completion requires linked evidence.',
      priority: kind === 'sales_handoff' ? 95 : kind === 'meeting' ? 85 : 75,
      evidence: [reference('market_touches', touch.id)], taskId: existing?.id || legacyOpenTask?.id, owner, dueAt,
      sourceTime: touch.created_at,
      disposition: fulfilled ? 'fulfilled' : suppressed || existing?.status === 'cancelled' ? 'suppressed' : owner ? 'assigned' : appointment || timestamp(dueAt) > timestamp(now) ? 'waiting' : 'review',
    })
  }
  for (const task of tasks.filter(t => ['open', 'in_progress'].includes(t.status))) {
    if ([...actions.values()].some(a => a.taskId === task.id)) continue
    const owner = task.owner_name || task.owner_user_id
    actions.set(`task:${task.id}`, { key: `task:${task.id}`, taskId: task.id, contactId: contact.id, kind: 'existing_task', title: task.title,
      reason: 'Existing accountable work is preserved.', priority: task.priority === 'urgent' ? 100 : task.priority === 'high' ? 85 : 65,
      evidence: [reference('crm_tasks', task.id)], owner, dueAt: task.due_at,
      disposition: suppressed ? 'suppressed' : owner ? 'assigned' : timestamp(task.due_at) > timestamp(now) ? 'waiting' : 'review' })
  }
  const openWork = [...actions.values()].some(a => ['assigned', 'review', 'waiting'].includes(a.disposition))
  for (const signal of input.signals || []) {
    if (signal.contact_id !== contact.id) continue
    const key = `relationship-signal:${contact.id}:${signal.source}:${signal.id}`
    const existing = tasks.find(t => t.source_key === key)
    const fresh = timestamp(signal.occurred_at) > 0 && timestamp(now) - timestamp(signal.occurred_at) >= 0 && timestamp(now) - timestamp(signal.occurred_at) <= 30 * DAY
    const actionable = signal.relevant === true && fresh && !suppressed && !openWork && !contact.owner_name && !contact.assigned_manager_user_id && relationship.engagement !== 'needs_review'
    actions.set(key, { key, contactId: contact.id, kind: signal.kind, title: `Review ${String(signal.kind).replaceAll('_', ' ')}`,
      reason: actionable ? 'Recent linked event is eligible for internal review, not automatic outreach.' : 'Retain signal only: stale, suppressed, uncertain or an existing conversation takes priority.',
      priority: signal.kind === 'referral' ? 90 : signal.kind === 'job_completed' ? 80 : 45,
      evidence: [reference(signal.source, signal.id)], taskId: existing?.id, sourceTime: signal.occurred_at,
      disposition: existing?.status === 'completed' ? 'fulfilled' : existing?.status === 'cancelled' ? 'graph_only' : actionable ? 'review' : 'graph_only' })
  }
  return [...actions.values()].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
}

export function relationshipTasks(actions: RelationshipAction[], contacts: Row[], now: string): CRMTask[] {
  const byId = new Map(contacts.map(c => [c.id, c]))
  return actions.filter(a => a.disposition === 'review' && !a.taskId).map(a => {
    const contact = byId.get(a.contactId)
    return { id: a.key, sourceKey: a.key, source: 'condition', relatedType: 'relationship', relatedId: a.contactId,
      relatedLabel: contact?.name || contact?.company, title: a.title, status: 'open', priority: a.priority >= 90 ? 'urgent' : a.priority >= 75 ? 'high' : 'normal',
      category: 'relationship_development', branch: contact?.city,
      description: `${a.reason}\nPolicy: ${RELATIONSHIP_POLICY}\nEvidence: ${a.evidence.map(e => `${e.source}/${e.id}`).join(', ')}\nReview the full thread before any communication.`,
      dueAt: a.dueAt, createdAt: now, updatedAt: now }
  })
}

const normalize = (value: unknown) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export function resolveNamedReferrer(query: { name: string; company?: string; city?: string }, contacts: Row[]) {
  const name = normalize(query.name)
  if (!name) return { candidates: [], requiresConfirmation: true }
  const candidates = contacts.flatMap(c => {
    const person = normalize(c.name); const business = normalize(c.company)
    const exact = person === name && person !== business
    const partial = person.split(' ').includes(name) && person !== business
    if (!exact && !partial) return []
    const reasons = [exact ? 'exact_person_name' : 'partial_person_name']
    if (query.company && normalize(query.company) === business) reasons.push('company_match')
    if (query.city && normalize(query.city) === normalize(c.city)) reasons.push('city_match')
    return [{ contactId: c.id, name: c.name, company: c.company, city: c.city, score: (exact ? 60 : 20) + (reasons.includes('company_match') ? 25 : 0) + (reasons.includes('city_match') ? 15 : 0), reasons }]
  }).sort((a, b) => b.score - a.score || String(a.contactId).localeCompare(String(b.contactId)))
  return { candidates: candidates.slice(0, 20), candidateCount: candidates.length, requiresConfirmation: true }
}

/** Cash, booked value and recognized revenue are deliberately different measures. */
export function referralOutcomes(referrals: Row[], leads: Row[], quotes: Row[], costs: Row[]) {
  const leadById = new Map(leads.map(l => [l.id, l.data || l]))
  const quoteById = new Map(quotes.map(q => [q.id, q.data || q]))
  const seen = new Set<string>()
  return referrals.flatMap(referral => {
    const key = `${referral.contact_id}:${referral.crm_lead_id || referral.job_id || referral.id}`
    if (seen.has(key)) return []
    seen.add(key)
    const lead = leadById.get(referral.crm_lead_id)
    const quote = lead?.quoteId ? quoteById.get(lead.quoteId) : null
    const payments = new Map<string, Row>((quote?.paymentRecords || []).map((p: Row) => [p.id, p]))
    const paid = payments.size ? [...payments.values()].reduce((sum, p) => sum + Math.max(0, Math.round(Number(p.amount || 0) * 100) - Math.round(Number(p.refundedAmount || (p.status === 'refunded' ? p.amount : 0)) * 100)), 0) : null
    const jobCosts = costs.filter(c => c.lead_id === referral.crm_lead_id)
    const recordedCost = jobCosts.length ? jobCosts.reduce((sum, c) => sum + Number(c.amount_cents || 0), 0) : null
    const completed = ['completed', 'customer_success'].includes(lead?.stage)
    return [{ contactId: referral.contact_id, referralId: referral.id, leadId: referral.crm_lead_id || null,
      quoteId: lead?.quoteId || null, completed, stage: lead?.stage || referral.job_status || 'unknown',
      bookedValueCents: quote ? Math.round(Number(quote.total) * 100) : referral.booked_amount_cents ?? null,
      netCollectedCents: paid, recordedCostCents: recordedCost,
      recognizedRevenueCents: null, actualGrossProfitCents: null,
      financialCoverage: 'Payment records are cash including tax; costs may be incomplete. Recognition and final cost reconciliation are not evidenced.' }]
  })
}

export function relationshipMomentum(input: { touches: Row[]; tasks: Row[]; referrals: Row[]; appointments: Row[]; now: string }) {
  const recent = (row: Row, field: string) => timestamp(row[field]) > 0 && timestamp(input.now) - timestamp(row[field]) >= 0 && timestamp(input.now) - timestamp(row[field]) <= 90 * DAY
  const components = [
    { name: 'recent_inbound', weight: 2, ids: input.touches.filter(t => t.direction === 'inbound' && recent(t, 'created_at')).map(t => t.id), source: 'market_touches' },
    { name: 'completed_promises', weight: 3, ids: input.tasks.filter(t => t.status === 'completed' && recent(t, 'completed_at')).map(t => t.id), source: 'crm_tasks' },
    { name: 'referrals', weight: 8, ids: input.referrals.filter(r => recent(r, 'created_at')).map(r => r.id), source: 'partner_referrals' },
    { name: 'meetings', weight: 5, ids: input.appointments.filter(a => a.status === 'completed' && recent(a, 'scheduled_at')).map(a => a.id), source: 'market_appointments' },
  ].map(c => ({ ...c, ids: [...new Set(c.ids)], contribution: Math.min(new Set(c.ids).size, 10) * c.weight }))
  return { windowDays: 90, score: components.reduce((sum, c) => sum + c.contribution, 0), components, purpose: 'human_attention_only' }
}

export function autonomyEligibility(evidence: { action: string; reviewed: number; failures: number; complaints: number; corrections: number; policyVersion: string }) {
  const eligibleAction = ['send_requested_card', 'answer_verified_service_area'].includes(evidence.action)
  const earned = eligibleAction && evidence.policyVersion === RELATIONSHIP_POLICY && evidence.reviewed >= 1000 && evidence.failures === 0 && evidence.complaints === 0 && evidence.corrections === 0
  return { eligibleForPromotionReview: earned, activeLevel: 2, automaticPromotion: false,
    reason: earned ? 'Evidence threshold met; explicit policy approval still required.' : 'Remain draft/review until action-specific evidence is sufficient.' }
}

export function relationshipExperiment(contact: Row) {
  const experimentKey = `${RELATIONSHIP_POLICY}:next-step:${normalize(contact.industry) || 'unknown'}:${normalize(contact.city) || 'unknown'}`
  return { experimentKey, variant: assignExperimentVariant({ experimentKey, subjectId: contact.id, variants: [{ id: 'card_offer', weight: 1 }, { id: 'context_question', weight: 1 }] }), exposed: false }
}

/** Internal review only. Never grants channel/send permission or merges identities. */
export function triageRelationship(input: Parameters<typeof planRelationshipActions>[0] & { handoffs?: Row[] }) {
  const { contact, now } = input
  const state = projectRelationship(input)
  const actions = planRelationshipActions(input)
  const suppressed = state.contactability === 'suppressed'
  const add = (kind: string, id: string, source: string, dueAt: string, title: string, reason: string, priority: number) => {
    const key = `relationship-triage:${contact.id}:${kind}:${id}`
    const task = input.tasks.find(t => t.source_key === key && t.related_id === contact.id)
    actions.push({ key, contactId: contact.id, kind, title, reason, priority, dueAt: task?.due_at || dueAt,
      owner: task?.owner_name || contact.owner_name || 'John', taskId: task?.id,
      evidence: [reference(source, id)], disposition: suppressed ? 'suppressed' : task?.status === 'completed' ? 'fulfilled' : task?.status === 'cancelled' ? 'suppressed' : 'review' })
  }
  const inbound = input.touches.filter(t => t.contact_id === contact.id && t.direction === 'inbound' &&
    ['sms', 'email'].includes(t.channel) && String(t.notes || '').trim() &&
    !t.metadata?.is_auto_reply && !t.metadata?.auto_reply && !t.metadata?.is_reaction &&
    !['auto_reply', 'reaction', 'delivery_event'].includes(t.outcome_code) &&
    !/^(?:Inbound SMS:\s*)?(?:Liked|Loved|Disliked|Laughed at|Emphasized|Questioned)\s+[“"]/i.test(t.notes))
    .sort((a,b) => timestamp(b.created_at) - timestamp(a.created_at) || String(b.id).localeCompare(String(a.id)))[0]
  if (inbound && timestamp(inbound.created_at)) {
    // Printer receipts, calls and failed/queued messages cannot discharge an unanswered message.
    const answered = input.touches.some(t => t.contact_id === contact.id && ['sms','email'].includes(t.channel) &&
      hasAcceptedOutboundEvidence(t) && timestamp(t.created_at) > timestamp(inbound.created_at) && !t.metadata?.is_auto_reply)
    if (!answered) add('inbound_review', inbound.id, 'market_touches', new Date(timestamp(inbound.created_at) + 4 * 3600000).toISOString(),
      'Review unanswered partner reply', 'Read the full thread; an acknowledgment, reaction or unrelated receipt is not proof a request was fulfilled.', 90)
  }
  for (const appointment of input.appointments || []) {
    if (appointment.contact_id !== contact.id || appointment.status !== 'scheduled' || !timestamp(appointment.scheduled_at)) continue
    const due = timestamp(appointment.scheduled_at) + DAY
    if (due <= timestamp(now)) add('meeting_outcome', appointment.id, 'market_appointments', new Date(due).toISOString(),
      'Record meeting outcome', 'Outcome is unknown. Confirm whether the meeting happened before proposing a reschedule.', 85)
  }
  for (const row of input.handoffs || []) {
    const h = row.data || row
    if (h.partnerReferralContactId !== contact.id || h.handoffStatus !== 'new' || h.handoffAcknowledgedAt || !timestamp(h.handoffAt)) continue
    add('handoff_acknowledgment', row.id, 'crm_leads', handoffReviewDue(h.handoffAt), 'Confirm sales accepted partner handoff',
      'Escalate internally to John if overdue. Contact the assigned salesperson; do not start another partner/customer thread.', 95)
  }
  return actions.filter(a => a.kind !== 'existing_task' || !actions.some(b => b !== a && b.taskId === a.taskId && b.kind !== 'existing_task')).map(a => ({ ...a, overdue: Boolean(a.dueAt && timestamp(a.dueAt) <= timestamp(now) && !['fulfilled','suppressed','graph_only'].includes(a.disposition)) }))
    .sort((a,b) => Number(b.overdue)-Number(a.overdue) || b.priority-a.priority || timestamp(a.dueAt)-timestamp(b.dueAt) || a.key.localeCompare(b.key))
}

/** Four working hours, weekdays 09:00–17:00 Toronto. Holidays are not yet modeled. */
export function handoffReviewDue(start: string) {
  const initial = Date.parse(start)
  if (!Number.isFinite(initial)) throw new Error('Invalid handoff timestamp')
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
  let time = initial, remaining = 240
  while (remaining > 0) {
    const parts = format.formatToParts(new Date(time))
    const day = parts.find(p=>p.type==='weekday')?.value
    const hour = Number(parts.find(p=>p.type==='hour')?.value)
    if (day !== 'Sat' && day !== 'Sun' && hour >= 9 && hour < 17) remaining--
    time += 60000
  }
  return new Date(time).toISOString()
}
