import { analyzePartnershipEmailReply, emailText } from './partnership-email-replies'

type Row = Record<string, any>
const systemKinds = new Set(['automatic_reply', 'verification', 'verification_pending_review', 'delivery_failure'])
const requestIntents = new Set(['card_or_info', 'quote', 'referral', 'vendor_registration', 'later_date'])
const stamp = (row: Row) => Date.parse(row.created_at || '')
function content(t: Row) {
  const m = t.metadata || {}
  return { subject: m.subject || String(t.notes || '').match(/^Subject:\s*([^\n]+)/)?.[1] || '', body: emailText(m.body || m.reply_preview || String(t.notes || '').replace(/^Subject:[^\n]*\n*/i, '')) }
}
export function humanEmailTouch(t: Row) {
  if (t.channel !== 'email' || t.direction !== 'inbound' || !Number.isFinite(stamp(t))) return false
  const m = t.metadata || {}, text = content(t)
  if (m.human_reply === false || m.internal_copy || systemKinds.has(m.email_kind)) return false
  if (/^SES\s+(?:bounced?|delivered|opened|clicked|complained|rejected|accepted)\s+event\b/i.test(String(t.notes || '').trim())) return false
  if (m.event_type && /bounce|delivery|open|click|complaint|reject/i.test(String(m.event_type))) return false
  if (/^(?:email_)?(?:opened|delivered|clicked|bounced|complained|accepted|delivery_failure|automatic_reply|verification)/i.test(t.outcome_code || '')) return false
  if (/ses.*(?:event|webhook)|provider_event/i.test(m.source || '')) return false
  return !systemKinds.has(analyzePartnershipEmailReply(text.subject, text.body).kind)
}
export function outboundReceipt(t: Row): string | null {
  if (t.channel !== 'email' || t.direction !== 'outbound' || !Number.isFinite(stamp(t))) return null
  const m = t.metadata || {}, state = String(m.delivery_state || m.status || '').toLowerCase()
  if (/reserved|pending|draft|fail|bounce|reject|cancel|ambiguous|hold/.test(state)) return null
  const provider = m.provider_message_id || m.providerMessageId || m.ses_message_id
  if (provider && /^(?:accepted|sent|delivered)$/.test(state)) return String(provider)
  if ((m.zoho_message_id || m.message_id) && /zoho/i.test(m.source || m.provider || '') && (m.sent_folder === true || /sent|outbound/i.test(m.folder_type || state))) return String(m.zoho_message_id || m.message_id)
  return null
}
export function auditEmailContact(contact: Row, touches: Row[], tasks: Row[]) {
  const inbound = touches.filter(humanEmailTouch).sort((a, b) => stamp(b) - stamp(a) || String(b.id).localeCompare(String(a.id)))[0]
  if (!inbound) return null
  const text = content(inbound), analysis = analyzePartnershipEmailReply(text.subject, text.body)
  const later = touches.filter(t => stamp(t) > stamp(inbound) && outboundReceipt(t)).sort((a,b) => stamp(a)-stamp(b))
  const laterUnproven = touches.filter(t => t.channel === 'email' && t.direction === 'outbound' && stamp(t) > stamp(inbound) && !outboundReceipt(t))
  const openTasks = tasks.filter(t => !['done', 'completed', 'closed', 'cancelled', 'canceled'].includes(String(t.status).toLowerCase()))
  const stale = later.length ? openTasks.filter(t => /reply|respond|inbound.*email/i.test(`${t.title || ''} ${t.source_key || ''}`) && Number.isFinite(stamp(t)) && stamp(t) <= stamp(later[0])) : []
  const review = inbound.metadata?.partnership_review || {}
  const receiptTouch = later.find(t => t.id === review.fulfilled_by_touch_id && outboundReceipt(t) === review.provider_receipt)
  const explicitReceipt = receiptTouch && review.reply_required === false && review.reviewed_at && review.note
    ? { sourceInboundTouchId: inbound.id, fulfilledByTouchId: receiptTouch.id, providerReceipt: review.provider_receipt, reviewedAt: review.reviewed_at, note: review.note, interpretation: 'Explicit review receipt exists; this audit does not independently verify that every promised item was fulfilled.' }
    : null
  const suppressed = Boolean(contact.do_not_contact || contact.email_unsubscribed_at || contact.cross_channel_suppressed_at || analysis.kind === 'opt_out')
  return {
    contactId: contact.id, company: contact.company, city: contact.city, email: contact.email,
    newestHumanInbound: { id: inbound.id, at: inbound.created_at, subject: text.subject, preview: text.body.slice(0, 650), analysis },
    suppressed, unansweredHumanReplyCandidate: !suppressed && later.length === 0,
    subsequentReceiptBackedOutbound: later.map(t => ({ id: t.id, at: t.created_at, receipt: outboundReceipt(t) })),
    subsequentOutboundWithoutEstablishedReceipt: laterUnproven.map(t => ({ id: t.id, at: t.created_at })),
    openTasks: openTasks.map(t => ({ id:t.id, title:t.title, status:t.status, dueAt:t.due_at })),
    answeredWithPotentiallyStaleOpenReviewTasks: stale.map(t => t.id),
    pendingFulfilmentReview: !suppressed && requestIntents.has(analysis.intent) && !explicitReceipt,
    explicitFulfilmentReceipt: explicitReceipt,
    reviewNote: 'Outbound activity alone does not prove the request was fulfilled. No task was closed or message sent.',
  }
}
