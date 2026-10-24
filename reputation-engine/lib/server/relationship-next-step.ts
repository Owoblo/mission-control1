import { createHash } from 'node:crypto'
import type { SessionPayload } from '../auth'
import { NEXT_STEP_POLICY, projectNextSteps, receiptDelivery, type EvidenceRow, type NextStep } from '../relationship-next-step'
import { requireSupabaseEnv } from './runtime'
import { readCompleteRest } from './read-complete-rest'
import { partnershipScopeFilter, partnershipRecordMatchesSession, canSeeAllPartnershipMarkets } from './partnership-access'

export class NextStepError extends Error {
  constructor(message: string, public status = 503) { super(message) }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function assertNextStepAccess(session: SessionPayload | null, contactId?: string) {
  if (!session || !['owner', 'manager', 'partnership_manager'].includes(session.role || '')) throw new NextStepError('Unauthorized', 401)
  if (contactId !== undefined && !uuid.test(contactId)) throw new NextStepError('Invalid contact', 400)
}
export async function loadNextSteps(session: SessionPayload, contactId?: string) {
  assertNextStepAccess(session, contactId)
  const { url, headers } = requireSupabaseEnv()
  const startedAt = new Date().toISOString()
  const read = (table: string, query: string) => readCompleteRest<EvidenceRow>(`${url}/rest/v1/${table}?${query}`, headers,
    (endpoint, options) => fetch(endpoint, { ...options, signal: AbortSignal.timeout(15000) }), 100000)
  // Authorize identity before loading any associated history.
  const candidates = await read('market_contacts', `select=id,name,company,email,city,stage,owner_name,assigned_manager_user_id,do_not_contact,cross_channel_suppressed_at${contactId ? `&and=(id.eq.${contactId})` : partnershipScopeFilter(session, ['city'], true).replace('id.eq.__no_partnership_market__', 'id.is.null')}`)
  if (contactId && !candidates.length) throw new NextStepError('Contact not found', 404)
  const contacts = candidates.filter(c => partnershipRecordMatchesSession(session, c))
  if (contactId && !contacts.length) throw new NextStepError('Forbidden', 403)
  async function related(table: string, field: string, select: string, extra = '') {
    if (!contacts.length) return []
    if (!contactId && canSeeAllPartnershipMarkets(session)) return read(table, `select=${select}${extra}`)
    const rows: EvidenceRow[] = []
    for (let start = 0; start < contacts.length; start += 100) {
      const ids = contacts.slice(start, start + 100).map(c => c.id).join(',')
      rows.push(...await read(table, `select=${select}&${field}=in.(${ids})${extra}`))
    }
    return rows
  }
  const [touches, tasks, logs] = await Promise.all([
    related('market_touches', 'contact_id', 'id,contact_id,channel,direction,notes,outcome_code,metadata,created_at'),
    related('crm_tasks', 'related_id', 'id,related_id,related_type,source_key,category,title,status,owner_name,owner_user_id,due_at,updated_at,completed_at,outcome_note'),
    related('partner_activity_logs', 'contact_id', 'id,contact_id,action,metadata,created_at', '&action=in.(next_step.corrected,next_step.receipt_linked,relationship.fulfilment)'),
  ])
  // SES callbacks are durable events, not updates to the original message.
  // Match the exact authorized message and recipient; never treat opens as delivery.
  const emailIds = [...new Set(touches.filter(t => t.direction === 'outbound' && t.channel === 'email').map(t =>
    t.metadata?.provider_message_id || t.metadata?.provider_id || t.metadata?.sesMessageId).filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const providerEvents: EvidenceRow[] = []
  for (let start = 0; start < emailIds.length; start += 100) {
    const query = new URLSearchParams({ select: 'id,contact_id,provider_message_id,event_type,recipient_email,occurred_at',
      provider_message_id: `in.(${emailIds.slice(start, start + 100).map(id => '"' + id.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',')})` })
    providerEvents.push(...await read('email_provider_events', query.toString()))
  }
  const eventStatus: Record<string, string> = { email_delivered: 'delivered', email_bounced: 'bounced', email_complained: 'complained', email_rejected: 'rejected', email_provider_accepted: 'sent', email_delivery_delayed: 'unknown' }
  const recipientKey = (value: unknown) => String(value || '').toLowerCase().match(/[^\s<>]+@[^\s<>]+/)?.[0] || ''
  for (const touch of touches.filter(t => t.direction === 'outbound' && t.channel === 'email')) {
    const m = touch.metadata || {}, providerId = m.provider_message_id || m.provider_id || m.sesMessageId
    const recipient = recipientKey(m.to || contacts.find(c => c.id === touch.contact_id)?.email)
    const event = providerEvents.filter(e => e.provider_message_id === providerId && (!e.contact_id || e.contact_id === touch.contact_id) && recipient && recipientKey(e.recipient_email) === recipient && eventStatus[e.event_type])
      .sort((a,b) => Number(['email_bounced','email_complained','email_rejected'].includes(b.event_type)) - Number(['email_bounced','email_complained','email_rejected'].includes(a.event_type)) || Number(b.event_type === 'email_delivered') - Number(a.event_type === 'email_delivered') || String(b.occurred_at).localeCompare(String(a.occurred_at)))[0]
    if (event) touch.metadata = { ...m, status: eventStatus[event.event_type], delivery_status: eventStatus[event.event_type], provider_status: eventStatus[event.event_type], delivery_state: eventStatus[event.event_type], next_step_provider_event_id: event.id }
  }
  const generatedAt = new Date().toISOString()
  const rows: NextStep[] = []
  function group(items: EvidenceRow[], field: string) {
    const groups = new Map<string, EvidenceRow[]>()
    for (const item of items) { const key = String(item[field]); const values = groups.get(key) || []; values.push(item); groups.set(key, values) }
    return groups
  }
  const touchGroups = group(touches, 'contact_id'), taskGroups = group(tasks, 'related_id'), logGroups = group(logs, 'contact_id')
  for (const contact of contacts) {
    const ct = touchGroups.get(contact.id) || [], kt = taskGroups.get(contact.id) || [], lt = logGroups.get(contact.id) || []
    const evidenceVersion = hash([NEXT_STEP_POLICY, contact, ct, kt, lt.filter(l => ['next_step.corrected', 'next_step.receipt_linked', 'relationship.fulfilment'].includes(l.action))])
    rows.push(...projectNextSteps({ contact, touches: ct, tasks: kt, logs: lt, now: generatedAt, evidenceVersion }))
  }
  return { policyVersion: NEXT_STEP_POLICY, generatedAt, coverage: { complete: true, startedAt, transactional: false, scope: 'authorized_recorded_material_requests',
    sources: ['market_contacts', 'market_touches', 'crm_tasks', 'partner_activity_logs', ...(emailIds.length ? ['email_provider_events'] : [])], excludes: ['unrecorded_promises', 'external_mailboxes', 'physical_delivery_verification'] }, rows, contacts, touches, tasks }
}
export async function actOnNextStep(session: SessionPayload, body: Record<string, unknown>) {
  const contactId = String(body.contactId || '')
  assertNextStepAccess(session, contactId)
  const actions = ['shown', 'review', 'create_task', 'defer', 'correct', 'link_receipt']
  if (!actions.includes(String(body.action))) throw new NextStepError('Invalid action', 400)
  const data = await loadNextSteps(session, contactId)
  const step = data.rows.find(r => r.key === body.key)
  if (!step || step.evidenceVersion !== body.evidenceVersion) throw new NextStepError('The conversation or task changed. Refresh before continuing.', 409)
  const action = String(body.action)
  if (action !== 'shown' && action !== 'review' && ['suppressed', 'fulfilled', 'reviewed'].includes(step.state)) throw new NextStepError('This request is no longer actionable. Refresh the record.', 409)
  const { url, headers } = requireSupabaseEnv()
  async function write(table: string, query: string, method: string, value: unknown, prefer = 'return=representation') {
    const response = await fetch(`${url}/rest/v1/${table}?${query}`, { method, headers: { ...headers, Prefer: prefer }, body: JSON.stringify(value), cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new NextStepError('Could not save the change. Refresh to check the recorded result before retrying.')
    return response.status === 204 ? [] : response.json()
  }
  let receipt: EvidenceRow | undefined
  if (action === 'link_receipt') {
    receipt = data.touches.find(t => t.id === body.receiptId && t.contact_id === contactId)
    if (!receipt || step.kind === 'physical_card' || (step.kind === 'email' && receipt.channel !== 'email') ||
        !receiptDelivery(receipt) || Date.parse(receipt.created_at) < Date.parse(step.requestedAt)) throw new NextStepError('Select a later outbound provider record for this request and contact.', 400)
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (action === 'correct' && (!note || note.length > 1000)) throw new NextStepError('Record why this suggestion needs correction (1–1,000 characters).', 400)
  let taskId = step.taskId
  if (action === 'create_task' || action === 'defer') {
    const due = typeof body.dueAt === 'string' ? body.dueAt : null
    if (action === 'defer' && (!due || !Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now())) throw new NextStepError('Choose a future internal review time.', 400)
    const existing = data.tasks.find(t => t.id === step.taskId)
    const legacyWork = data.tasks.some(t => ['open', 'in_progress'].includes(t.status) && (step.kind === 'physical_card' ? ['partnership_address_fulfilment', 'partnership_print_delivery'].includes(t.category) : t.category === 'partner_email_fulfilment'))
    if (!existing && legacyWork) throw new NextStepError('Existing fulfilment work is already open. Review that task before creating another.', 409)
    if (existing && action === 'defer') {
      if (!existing.updated_at) throw new NextStepError('Refresh this task before changing its review date.', 409)
      const changed = await write('crm_tasks', new URLSearchParams({ id: `eq.${existing.id}`, updated_at: `eq.${existing.updated_at}`, status: 'in.(open,in_progress)' }).toString(), 'PATCH', { due_at: due, updated_at: new Date().toISOString() })
      if (!changed.length) throw new NextStepError('The task changed. Refresh before rescheduling.', 409)
    } else if (!existing) {
      taskId = `material-${hash(step.key).slice(0, 32)}`
      const contact = data.contacts[0]
      const created = await write('crm_tasks', 'on_conflict=source_key', 'POST', { id: taskId, source_key: step.key, source: 'condition', title: step.title,
        description: `${step.reason}\nRequest: market_touches/${step.requestId}\nReview the original message and existing delivery evidence before contacting the partner.`, status: 'open', priority: 'normal', category: 'relationship_development',
        owner_name: contact.owner_name || session.name || null, owner_user_id: contact.assigned_manager_user_id || (!contact.owner_name ? session.userId : null) || null,
        branch: session.branch || null, related_type: 'relationship', related_id: contactId, related_label: step.contactName,
        due_at: due, created_by_name: session.name || null, created_by_user_id: session.userId || null }, 'resolution=ignore-duplicates,return=representation')
      if (!created.length) throw new NextStepError('A task was already created. Refresh to see its owner and review date.', 409)
    }
  }
  const eventAction = action === 'correct' ? 'corrected' : action === 'link_receipt' ? 'receipt_linked' : action === 'review' ? 'review_opened' : action
  const eventHash = hash([contactId, step.key, step.evidenceVersion, session.userId || session.name, action, body.receiptId || null, body.dueAt || null, note])
  const id = `${eventHash.slice(0,8)}-${eventHash.slice(8,12)}-4${eventHash.slice(13,16)}-a${eventHash.slice(17,20)}-${eventHash.slice(20,32)}`
  await write('partner_activity_logs', 'on_conflict=id', 'POST', { id, contact_id: contactId, action: `next_step.${eventAction}`, actor_user_id: session.userId || null, actor_name: session.name || null,
    metadata: { insight_key: step.key, policy_version: NEXT_STEP_POLICY, model_version: 'deterministic-material-requests-v1', evidence_version: step.evidenceVersion, request_touch_id: step.requestId, kind: step.kind,
      request_at: step.requestedAt, recommendation: { title: step.title, reason: step.reason, owner: step.owner, due_at: step.dueAt, needs_confirmation: step.needsConfirmation },
      evidence_sources: data.coverage.sources, review_due_at: body.dueAt || null,
      observed_state: step.state, request_excerpt: step.excerpt, task_id: taskId, receipt_touch_id: receipt?.id || null, provider_state: receipt ? receiptDelivery(receipt) : null, note: note || null,
      semantics: action === 'shown' ? 'unique_visible_user_context' : 'human_action', outbound_sent: false } }, 'resolution=ignore-duplicates,return=minimal')
  return { ok: true, outboundSent: false, taskId }
}
