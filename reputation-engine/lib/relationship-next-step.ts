/** Evidence-backed material requests. This projection never authorizes a send. */
export const NEXT_STEP_POLICY = 'relationship-next-step-v2'
export type EvidenceRow = Record<string, any> & { id: string }
export type MaterialKind = 'digital_card' | 'physical_card' | 'email' | 'references' | 'insurance'
export type NextStep = {
  key: string; contactId: string; contactName: string; kind: MaterialKind
  title: string; reason: string; requestedAt: string; excerpt: string
  state: 'review' | 'waiting' | 'submitted' | 'fulfilled' | 'reviewed' | 'suppressed'
  owner: string | null; dueAt: string | null; taskId: string | null
  requestId: string; receiptId: string | null; delivery: string | null
  needsConfirmation: boolean; evidenceVersion: string
}
const kinds: Record<string, MaterialKind> = {
  package_requested: 'digital_card', media_requested: 'digital_card', digital_only: 'digital_card',
  postcard_requested: 'physical_card', asks_for_email: 'email', asks_references: 'references',
}
const titles: Record<MaterialKind, string> = {
  digital_card: 'Review requested digital card', physical_card: 'Arrange requested physical cards',
  email: 'Review requested email', references: 'Review requested references', insurance: 'Review requested insurance documents',
}
const time = (v: unknown) => Date.parse(String(v || '')) || 0
export function receiptDelivery(touch: EvidenceRow): 'delivered' | 'submitted' | null {
  if (touch.direction !== 'outbound' || !['sms', 'mms', 'email'].includes(touch.channel)) return null
  const m = touch.metadata || {}
  const statuses = [m.delivery_status, m.provider_status, m.delivery_state, m.status].map(v => String(v || '').toLowerCase())
  if (statuses.some(s => ['failed', 'undelivered', 'bounced', 'rejected', 'complained', 'canceled', 'cancelled'].includes(s))) return null
  if (statuses.some(s => ['delivered', 'read'].includes(s))) return 'delivered'
  const providerId = m.twilioSid || m.twilio_sid || m.provider_message_id || m.provider_id || m.sesMessageId
  if (statuses.some(s => ['queued', 'pending', 'scheduled', 'reserved', 'sending', 'unknown'].includes(s))) return providerId ? 'submitted' : null
  if (statuses.some(s => ['accepted', 'sent'].includes(s)) || providerId) return 'submitted'
  return null
}
function requestKind(t: EvidenceRow): MaterialKind | null {
  if (t.direction !== 'inbound' || !['sms', 'mms', 'email'].includes(t.channel)) return null
  if (t.metadata?.is_reaction || t.metadata?.is_auto_reply || t.metadata?.auto_reply || t.metadata?.human_reply === false) return null
  // Insurance is only a candidate for human review, never a claim about coverage.
  const text = String(t.notes || '')
  if (/\b(?:can|could|would) you (?:please )?(?:send|share|email|provide)\b[^.!?\n]{0,80}\b(?:insurance|certificate of insurance|COI)\b/i.test(text) ||
      /\bplease (?:send|share|email|provide)\b[^.!?\n]{0,80}\b(?:insurance|certificate of insurance|COI)\b/i.test(text)) return 'insurance'
  return kinds[t.outcome_code] || null
}
export function projectNextSteps(input: { contact: EvidenceRow; touches: EvidenceRow[]; tasks: EvidenceRow[]; logs: EvidenceRow[]; now: string; evidenceVersion: string }): NextStep[] {
  const { contact } = input
  const touches = input.touches.filter(t => t.contact_id === contact.id)
  const tasks = input.tasks.filter(t => t.related_id === contact.id && ['partner', 'relationship'].includes(t.related_type))
  const logs = input.logs.filter(l => l.contact_id === contact.id)
  const suppressed = Boolean(contact.do_not_contact || contact.cross_channel_suppressed_at || ['dnc', 'opted_out', 'wrong_number', 'do_not_contact'].includes(contact.stage) ||
    touches.some(t => ['opt_out', 'opted_out', 'wrong_number'].includes(t.outcome_code)))
  return touches.flatMap(request => {
    const kind = requestKind(request)
    if (!kind || !time(request.created_at)) return []
    const key = `relationship-material:${contact.id}:${request.id}:${kind}`
    // Never associate an unrelated task or discharge a request because somebody replied later.
    const task = tasks.find(t => t.source_key === key || t.source_key === `relationship-request:${contact.id}:${request.id}:${kind}`)
    const reviews = logs.filter(l => l.metadata?.insight_key === key && l.action === 'next_step.corrected')
    const linked = logs.filter(l => l.action === 'next_step.receipt_linked' && l.metadata?.insight_key === key)
    const receipts = touches.filter(t => time(t.created_at) >= time(request.created_at) && (
      (request.metadata?.partnership_review?.fulfilled_by_touch_id === t.id) ||
      (t.metadata?.relationship_fulfilment?.request_touch_id === request.id && t.metadata?.relationship_fulfilment?.kind === kind) ||
      linked.some(l => l.metadata?.receipt_touch_id === t.id) ||
      logs.some(l => l.action === 'relationship.fulfilment' && l.metadata?.request_touch_id === request.id && l.metadata?.receipt_touch_id === t.id && l.metadata?.kind === kind)
    )).filter(t => kind !== 'physical_card' && (kind !== 'email' || t.channel === 'email'))
    const receipt = receipts.filter(t => receiptDelivery(t)).sort((a,b) => Number(receiptDelivery(b) === 'delivered') - Number(receiptDelivery(a) === 'delivered') || time(b.created_at) - time(a.created_at))[0] || receipts.slice().sort((a,b) => time(b.created_at) - time(a.created_at))[0]
    const delivery = receipt ? receiptDelivery(receipt) : null
    const dueAt = task?.due_at || null
    const needsConfirmation = kind === 'insurance' || Boolean(request.metadata?.partnership_ai && (
      Number(request.metadata.partnership_ai.confidence) < 0.85 || request.metadata.partnership_ai.risk_flags?.length))
    const unfinishedTask = task && ['open', 'in_progress'].includes(task.status)
    const state: NextStep['state'] = suppressed ? 'suppressed' : reviews.length || task?.status === 'cancelled' ? 'reviewed' :
      delivery === 'delivered' ? (unfinishedTask ? 'review' : 'fulfilled') : delivery === 'submitted' ? 'submitted' : receipt ? 'review' :
      task?.status === 'completed' ? 'reviewed' : time(dueAt) > time(input.now) ? 'waiting' : 'review'
    const reason = state === 'suppressed' ? 'Contact restrictions are active. Internal review only.' : state === 'fulfilled' ? 'A linked provider record confirms delivery; recipient review is not established.' :
      delivery === 'delivered' && unfinishedTask ? 'Delivery is recorded. The owned review task still needs an outcome; check it before arranging more outreach.' :
      state === 'submitted' ? 'The linked message was submitted. Delivery is not yet confirmed; check before sending again.' :
      state === 'reviewed' ? 'A human review or task outcome is recorded; this is not independent delivery confirmation.' :
      state === 'waiting' ? 'An owned review is scheduled. No outreach is needed from this reminder today.' :
      receipt && !delivery ? 'The linked send has no confirmed provider success. Review its outcome before any retry.' :
      needsConfirmation ? 'Confirm this request against the original message before choosing an action.' : 'A recorded request has no linked delivery evidence. Check the conversation before acting.'
    return [{ key, contactId: contact.id, contactName: contact.name || contact.company || 'Partner', kind, title: delivery === 'delivered' && unfinishedTask ? 'Record the request outcome' : titles[kind], reason,
      requestedAt: request.created_at, excerpt: String(request.notes || '').slice(0, 700), state, owner: task?.owner_name || (task?.owner_user_id ? 'Assigned team member' : null) || contact.owner_name || (contact.assigned_manager_user_id ? 'Assigned team member' : null),
      dueAt, taskId: task?.id || null, requestId: request.id, receiptId: receipt?.id || null, delivery, needsConfirmation, evidenceVersion: input.evidenceVersion }]
  }).sort((a,b) => Number(a.state !== 'review') - Number(b.state !== 'review') || time(a.requestedAt) - time(b.requestedAt) || a.key.localeCompare(b.key))
}
