import type { CRMLead } from './types'

export const FOLLOW_UP_REASONS = {
  needs_review: 'Needs conversation review',
  house_sale: 'Waiting on house sale / closing',
  date_pending: 'Waiting on date / storage / family',
  inventory_pending: 'Waiting on inventory / addresses',
  quote_decision: 'Considering quote',
  price_concern: 'Price or scope concern',
  callback_scheduled: 'Promised callback',
  referral_pending: 'Waiting on client introduction',
  customer_will_contact: 'Customer will contact us',
  future_move: 'Future move',
  outcome_unknown: 'Past enquiry — outcome unknown',
  closed: 'Closed / no further outreach',
} as const
export type FollowUpReason = keyof typeof FOLLOW_UP_REASONS
export type FollowUpPlan = {
  reason: FollowUpReason
  policy: 'proactive' | 'scheduled' | 'customer_led' | 'internal_only'
  ownerName: string
  nextAction: string
  reviewOn: string
  evidence: string
  reviewedAt: string
  reviewedBy: string
}
export type RadarLead = CRMLead & { followUpPlan?: FollowUpPlan; followUpIdentityReview?: boolean; followUpPlanHistory?: FollowUpPlan[] }
export function torontoDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function torontoReviewTime(day: string) {
  const midday = new Date(`${day}T12:00:00Z`)
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hourCycle: 'h23' }).format(midday))
  return `${day}T${String(9 + 12 - hour).padStart(2, '0')}:00:00Z`
}
// A dated plan is a human review instruction, not consent to an automated chase.
export function blocksAutomatedFollowUp(lead: RadarLead, kind: string) {
  return !!lead.followUpPlan && ['quote_followup', 'quote_viewed_followup', 'quote_expiry_followup', 'survey_followup', 'stale_reactivation', 'lost_feedback'].includes(kind)
}
export function validateFollowUpPlan(value: unknown): asserts value is FollowUpPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A follow-up plan is required.')
  const p = value as FollowUpPlan
  if (!Object.hasOwn(FOLLOW_UP_REASONS, p.reason)) throw new Error('Select a valid follow-up category.')
  if (!['proactive', 'scheduled', 'customer_led', 'internal_only'].includes(p.policy)) throw new Error('Select a valid contact policy.')
  for (const key of ['ownerName', 'nextAction', 'evidence'] as const) {
    if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 3000) throw new Error(`${key} is required (maximum 3000 characters).`)
  }
  if (p.reason !== 'closed' && (!/^\d{4}-\d{2}-\d{2}$/.test(p.reviewOn) || Number.isNaN(Date.parse(p.reviewOn)) || new Date(p.reviewOn).toISOString().slice(0, 10) !== p.reviewOn)) throw new Error('Set a valid next review date.')
  if (['customer_will_contact'].includes(p.reason) && p.policy !== 'customer_led') throw new Error('Respect the customer’s request to contact us themselves.')
}
export function closeFollowUpOnRecordedLoss(previous: RadarLead, next: RadarLead, actor: string, now = new Date().toISOString()): RadarLead {
  if (next.stage !== 'lost' || previous.stage === 'lost' && previous.lostReason === next.lostReason && previous.lostNotes === next.lostNotes) return next
  const oldPlan = previous.followUpPlan
  return { ...next, followUpPlan: { reason: 'closed', policy: 'internal_only', ownerName: oldPlan?.ownerName || next.assignedRepName || actor,
    reviewOn: '', nextAction: 'Routine outreach closed. Reconsider only after meaningful new customer contact or an explicit reviewed reopening.',
    evidence: `Recorded by ${actor}: ${next.lostReason || 'closed'}. ${next.lostNotes || ''}`.trim(), reviewedAt: now, reviewedBy: actor },
    followUpPlanHistory: [...(previous.followUpPlanHistory || []), ...(oldPlan ? [oldPlan] : [])].slice(-50) }
}
export function radarState(lead: RadarLead, now = new Date()) {
  const p = lead.followUpPlan
  const today = torontoDay(now)
  const lastCall = (lead.callLogs || []).map(c => c.date || '').sort().at(-1)
  const lastActivity = [lead.lastInboundAt, lastCall].filter(Boolean).sort().at(-1) || ''
  const inboundCalls = (lead.callLogs || []).filter(c => c.direction === 'inbound' && c.callOutcome === 'completed' && !c.isVoicemail).map(c => c.date || '')
  const lastInbound = [lead.lastInboundAt, ...inboundCalls].filter(Boolean).sort().at(-1) || ''
  const newActivity = !!p && Date.parse(p.reason === 'closed' ? lastInbound : lastActivity) > Date.parse(p.reviewedAt)
  const confirmedClosed = ['booked', 'completed', 'customer_success'].includes(lead.stage)
  const newCustomerContactAfterLoss = lead.stage === 'lost' && !!lead.lostAt && Date.parse(lastInbound) > Date.parse(lead.lostAt)
  const lossSupersedesPlan = !!p && lead.stage === 'lost' && !!lead.lostAt && Date.parse(lead.lostAt) > Date.parse(p.reviewedAt)
  const visible = !lead.mergedIntoLeadId && (lossSupersedesPlan ? newCustomerContactAfterLoss : p ? p.reason !== 'closed' || newActivity : !confirmedClosed && (lead.stage !== 'lost' || newCustomerContactAfterLoss))
  const reviewOn = p?.reviewOn || today
  const flags: string[] = []
  if (!p) flags.push('Needs category and next action')
  if (!p?.ownerName && !lead.assignedRepName) flags.push('Needs owner')
  if (newActivity) flags.push('New activity — review context')
  if (p && p.reason !== 'closed' && reviewOn < today) flags.push('Overdue review')
  if (p && lead.stage === 'lost' && p.reason !== 'closed') flags.push('Stage conflicts with follow-up plan')
  if (p && confirmedClosed && p.reason !== 'closed') flags.push('Booked or completed — reconcile the old follow-up plan')
  if (lead.followUpIdentityReview) flags.push('Hidden by normal lead list — verify linked records and lifecycle before contact')
  const waiting = lossSupersedesPlan || !!lead.followUpIdentityReview || confirmedClosed || p?.policy === 'customer_led' || p?.policy === 'internal_only'
  return { visible: Boolean(visible), reason: p?.reason || 'needs_review' as FollowUpReason,
    ownerName: p?.ownerName || lead.assignedRepName || 'Unassigned', reviewOn, lastActivity,
    due: Boolean(visible && (newActivity || reviewOn <= today)), flags,
    contactAllowed: Boolean(p && !waiting && p.reason !== 'closed' && p.reason !== 'needs_review' && reviewOn <= today && !newActivity),
    instruction: !p || newActivity ? 'Review latest conversation before contacting.' : waiting ? 'Internal review only. Respect customer timing.' : p.nextAction }
}
