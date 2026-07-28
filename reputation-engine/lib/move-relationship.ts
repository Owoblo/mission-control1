import type {
  LeadAttributionSignal,
  LeadOpportunityContext,
  MoveRelationship,
  MoveRelationshipRole,
  OpportunityPosition,
} from './types'

export const OPPORTUNITY_POSITION_LABELS: Record<OpportunityPosition, string> = {
  discovery: 'Discovery underway',
  collecting_inventory: 'Collecting inventory or photos',
  estimate_in_progress: 'Estimate in progress',
  reviewing_estimate: 'Reviewing the estimate',
  comparing_options: 'Comparing options',
  internal_decision: 'Decision with spouse or team',
  date_uncertain: 'Move date uncertain',
  ready_to_book: 'Ready to book',
  deposit_promised: 'Deposit promised',
  temporarily_unresponsive: 'Temporarily unresponsive',
  long_term_nurture: 'Long-term nurture',
}

export const MOVE_RELATIONSHIP_ROLE_LABELS: Record<MoveRelationshipRole, string> = {
  referring_realtor: 'Referring realtor',
  listing_realtor: 'Listing realtor',
  buyer_realtor: 'Buyer’s realtor',
  brokerage: 'Brokerage',
  property_manager: 'Property manager',
  building_manager: 'Building / maintenance manager',
  mortgage_broker: 'Mortgage broker',
  lender: 'Lender',
  employer: 'Employer',
  storage_facility: 'Storage facility',
  retirement_residence: 'Retirement residence',
  insurance: 'Insurance representative',
  customer_referrer: 'Customer / personal referrer',
  other: 'Other connection',
}

export const ATTRIBUTION_CHANNELS = [
  'Direct mail',
  'Google search',
  'Google Business Profile',
  'Realtor referral',
  'Partnership referral',
  'Customer referral',
  'Instagram',
  'Facebook',
  'Website',
  'Repeat customer',
  'Phone / walk-in',
  'Other',
] as const

export function opportunityHealthLabel(context?: LeadOpportunityContext) {
  if (!context) return 'Needs context'
  if (!context.nextAction?.trim() || !context.nextActionDueAt) return 'Needs next step'
  if (new Date(context.nextActionDueAt).getTime() < Date.now()) return 'Action overdue'
  if (context.bookingConfidence >= 75) return 'Strong opportunity'
  if (context.bookingConfidence >= 40) return 'Developing opportunity'
  return 'Early opportunity'
}

export function moveRelationshipLifecycleGaps(input: {
  context?: LeadOpportunityContext
  signals?: LeadAttributionSignal[]
}) {
  const gaps: string[] = []
  if (!input.context?.position) gaps.push('customer position')
  if (!input.context?.summary?.trim()) gaps.push('sales summary')
  if (!input.context?.nextAction?.trim() || !input.context?.nextActionDueAt) gaps.push('owned next step')
  if (!input.signals?.length) gaps.push('acquisition evidence')
  if (input.context?.relationshipReviewStatus !== 'complete') gaps.push('relationship review')
  return gaps
}

export function isMoveRelationshipLifecycleComplete(input: {
  context?: LeadOpportunityContext
  signals?: LeadAttributionSignal[]
}) {
  return moveRelationshipLifecycleGaps(input).length === 0
}

export function normalizeAttributionSignals(signals?: LeadAttributionSignal[]) {
  const seen = new Set<string>()
  return (signals || []).filter(signal => {
    const key = `${signal.channel.trim().toLowerCase()}|${(signal.detail || '').trim().toLowerCase()}|${signal.influence}`
    if (!signal.channel.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeMoveRelationships(relationships?: MoveRelationship[]) {
  const seen = new Set<string>()
  return (relationships || []).filter(relationship => {
    const key = relationship.contactId
      ? `${relationship.contactId}|${relationship.role}`
      : `${relationship.name.trim().toLowerCase()}|${(relationship.company || '').trim().toLowerCase()}|${relationship.role}`
    if (!relationship.name.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
