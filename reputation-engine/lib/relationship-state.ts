/** Read-only projection over existing CRM evidence. Never grants send permission. */
export type RelationshipEvidenceRow = Record<string, any>
export const RELATIONSHIP_PROJECTION_VERSION = 'relationship-evidence-v1'

const QUALIFYING_OUTCOMES = new Set([
  'postcard_requested', 'package_requested', 'media_requested', 'digital_only',
  'asks_contact_info', 'asks_for_email', 'asks_pricing', 'meeting_requested',
  'secondary_contact_referral', 'partner_lead_received',
])
const CONSTRUCTIVE_OUTCOMES = new Set(['warm_acknowledgement', 'positive_vague'])
const SUPPRESSED_OUTCOMES = new Set(['opt_out', 'opted_out', 'wrong_number'])

export function hasAcceptedOutboundEvidence(touch: RelationshipEvidenceRow) {
  const metadata = touch.metadata || {}
  const status = String(metadata.delivery_status || metadata.provider_status || metadata.delivery_state || metadata.status || '').toLowerCase()
  if (['failed', 'undelivered', 'canceled', 'cancelled', 'queued', 'pending', 'scheduled'].includes(status)) return false
  return touch.direction === 'outbound' && (
    ['sent', 'delivered', 'read'].includes(status) ||
    Boolean(metadata.twilioSid || metadata.twilio_sid || metadata.provider_message_id || metadata.sesMessageId)
  )
}

export function projectRelationship(input: {
  contact: RelationshipEvidenceRow
  touches: RelationshipEvidenceRow[]
  tasks: RelationshipEvidenceRow[]
  referrals: RelationshipEvidenceRow[]
}) {
  const { contact } = input
  const touches = input.touches.filter(t => t.contact_id === contact.id)
    .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
  const inbound = touches.filter(t => t.direction === 'inbound' && String(t.notes || '').trim())
  const latestInbound = inbound[inbound.length - 1]
  const outbound = touches.filter(hasAcceptedOutboundEvidence)
  const latestOutbound = outbound[outbound.length - 1]
  const evidence = touches.filter(t => {
    if (!QUALIFYING_OUTCOMES.has(t.outcome_code)) return false
    const prediction = t.metadata?.partnership_ai
    // Historical classifier output is a prediction, not an unconditional promotion.
    return !prediction || (Number(prediction.confidence) >= 0.85 && !(prediction.risk_flags || []).length)
  })
  const referrals = input.referrals.filter(r => r.contact_id === contact.id)
  const completedJobs = new Set(referrals.filter(r => r.job_id && r.job_status === 'completed').map(r => r.job_id))
  const suppressed = contact.do_not_contact === true || Boolean(contact.cross_channel_suppressed_at) || ['dnc', 'opted_out', 'wrong_number'].includes(contact.stage) ||
    touches.some(t => SUPPRESSED_OUTCOMES.has(t.outcome_code))
  const tasks = input.tasks.filter(t => t.related_id === contact.id && ['partner', 'relationship'].includes(t.related_type))
  const openTasks = tasks.filter(t => ['open', 'in_progress'].includes(t.status))
  const qualified = evidence.length > 0 || referrals.length > 0
  const constructive = !qualified && CONSTRUCTIVE_OUTCOMES.has(latestInbound?.outcome_code)
  return {
    contactId: contact.id,
    identity: { name: contact.name || null, company: contact.company || null, city: contact.city || null },
    contactability: suppressed ? 'suppressed' : 'requires_send_gate',
    qualification: qualified ? 'partner_qualified' : constructive ? 'constructive' : 'unclassified',
    production: completedJobs.size > 1 ? 'repeat_partner' : completedJobs.size === 1 ? 'producing_partner' : referrals.length ? 'referred' : 'not_evidenced',
    engagement: !latestInbound ? (outbound.length ? 'no_response' : 'unknown') :
      !latestOutbound || String(latestInbound.created_at) >= String(latestOutbound.created_at) ? 'needs_review' : 'outbound_after_reply',
    latestInboundId: latestInbound?.id || null,
    lastInboundAt: latestInbound?.created_at || null,
    qualificationEvidence: [...evidence.map(t => ({ source: 'market_touches', id: t.id })), ...referrals.map(r => ({ source: 'partner_referrals', id: r.id }))],
    openObligations: openTasks.map(t => ({ id: t.id, title: t.title, dueAt: t.due_at || null, owner: t.owner_name || t.owner_user_id || null })),
    // An outbound message is not evidence that a requested email, call or meeting happened.
    completedTaskEvidence: tasks.filter(t => t.status === 'completed').map(t => ({ id: t.id, completedAt: t.completed_at || null, outcome: t.outcome_note || null })),
    constructiveCandidate: constructive && !suppressed,
    recordedStage: contact.stage || null,
    referralCode: contact.tracking_code || null,
  }
}
