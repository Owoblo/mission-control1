import type { CRMLead, CRMQuote } from './types'
import type { CRMTask } from './tasks'

export type EconomicCost = { lead_id: string; category: string; amount_cents: number }
export type EconomicOutcome = { lead_id: string; actuals_complete?: boolean; actual_hours?: number | null }
// Legacy actuals_complete only means hours plus at least one cost. It is not a
// finance closeout. No existing outcome record is promoted to this contract.
export type EconomicCloseout = {
  reviewedBy: string
  reviewedAt: string
  finalRevenueCents: number
  directCostsComplete: boolean
  acquisitionCostCents: number | null
}

function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) ? value : null
}
function quoteCents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100))
    ? Math.round(value * 100) : null
}

export function assessEconomicTruth(input: {
  quotedRevenue: number | null
  costs: Pick<EconomicCost, 'category' | 'amount_cents'>[]
  completed: boolean
  closeout?: EconomicCloseout | null
}) {
  const quotedRevenueCents = quoteCents(input.quotedRevenue)
  const invalidCosts = input.costs.some(row => cents(row.amount_cents) === null || !row.category?.trim())
  // The existing marketing category is separated from delivery costs.
  const direct = input.costs.filter(row => row.category !== 'marketing')
  const acquisition = input.costs.filter(row => row.category === 'marketing')
  const sum = (rows: typeof direct) => rows.reduce((total, row) => total + row.amount_cents, 0)
  const review = input.closeout
  const reviewValid = Boolean(input.completed && review?.reviewedBy.trim() && Number.isFinite(Date.parse(review.reviewedAt)) && review.directCostsComplete && cents(review.finalRevenueCents) !== null && !invalidCosts)
  const postedDirectCostsCents = invalidCosts || (!direct.length && !reviewValid) ? null : cents(sum(direct))
  const postedAcquisitionCostsCents = invalidCosts || !acquisition.length ? null : cents(sum(acquisition))
  const provisionalContributionCents = quotedRevenueCents !== null && postedDirectCostsCents !== null
    ? cents(quotedRevenueCents - postedDirectCostsCents) : null
  const confirmedContributionCents = reviewValid && postedDirectCostsCents !== null && review
    ? cents(review.finalRevenueCents - postedDirectCostsCents) : null
  const acquisitionCents = review?.acquisitionCostCents === null ? null : cents(review?.acquisitionCostCents)
  const contributionAfterAcquisitionCents = confirmedContributionCents !== null && acquisitionCents !== null && acquisitionCents >= 0
    ? cents(confirmedContributionCents - acquisitionCents) : null
  const gaps: string[] = []
  if (quotedRevenueCents === null) gaps.push('Quote revenue unavailable')
  if (invalidCosts) gaps.push('Invalid cost records need review')
  if (postedDirectCostsCents === null) gaps.push('No usable delivery costs recorded')
  if (!input.completed) gaps.push('Job is not completed')
  if (!reviewValid) gaps.push('Final revenue and complete costs need finance review')
  if (contributionAfterAcquisitionCents === null) gaps.push('Complete acquisition expense is unconfirmed')
  return { quotedRevenueCents, postedDirectCostsCents, postedAcquisitionCostsCents,
    provisionalContributionCents, confirmedContributionCents, contributionAfterAcquisitionCents,
    status: confirmedContributionCents === null ? 'incomplete' as const : 'reviewed' as const, gaps }
}

export function selectEconomicQuote(lead: Pick<CRMLead, 'id' | 'quoteId'>, quotes: CRMQuote[]) {
  if (lead.quoteId) return quotes.find(q => q.id === lead.quoteId && q.leadId === lead.id) || null
  const accepted = quotes.filter(q => q.leadId === lead.id && ['accepted', 'invoiced'].includes(q.status))
  // Ambiguous revisions need human review; never select the most lucrative one.
  return accepted.length === 1 ? accepted[0] : null
}

export function buildEconomicTrace(input: {
  lead: CRMLead; quotes: CRMQuote[]; costs: EconomicCost[]; tasks: CRMTask[]; outcomes: EconomicOutcome[]
}) {
  const { lead } = input
  const quote = selectEconomicQuote(lead, input.quotes)
  const tasks = input.tasks.filter(t => ['lead', 'job'].includes(t.relatedType || '') && t.relatedId === lead.id)
  const openTasks = tasks.filter(t => t.status === 'open' || t.status === 'in_progress').sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || a.id.localeCompare(b.id))
  const task = openTasks[0]
  const context = lead.opportunityContext
  const economics = assessEconomicTruth({ quotedRevenue: quote?.subtotal ?? null,
    costs: input.costs.filter(c => c.lead_id === lead.id), completed: ['completed', 'customer_success'].includes(lead.stage) })
  const source = lead.attribution?.originalSource || lead.source || null
  const partnerId = lead.partnerReferralContactId || null
  const interview = lead.acquisitionInterview || null
  const gaps = [...economics.gaps]
  if (!source) gaps.unshift('Originating source is unknown')
  if (!interview) gaps.unshift('Ask how they heard about us and where they received the postcard')
  const owner = task ? task.ownerName || task.ownerUserId || null : context?.nextActionOwner || null
  const nextAction = task ? task.title : context?.nextAction || null
  const dueAt = task ? task.dueAt || null : context?.nextActionDueAt || null
  if (!['completed', 'customer_success', 'lost'].includes(lead.stage)) {
    if (!owner) gaps.push('Assign the next action owner')
    if (!nextAction) gaps.push('Record the next action')
    if (!dueAt || !Number.isFinite(Date.parse(dueAt))) gaps.push('Set a valid next action date')
  }
  return { id: lead.id, name: lead.name, branch: lead.branch || 'unassigned', stage: lead.stage,
    source, sourceDetail: lead.sourceDetail || null, sourceLeadId: lead.sourceLeadId || null,
    attributionTouches: (lead.attributionSignals || []).map(s => ({ channel: s.channel, influence: s.influence, confidence: s.confidence })),
    partnerId, partnerName: partnerId ? lead.partnerReferralName || null : null,
    acquisitionInterview: interview,
    linkedRelationshipId: lead.relationshipContactId || null,
    pursuitReason: context?.summary || null,
    quoteId: quote?.id || null, outcomeRecorded: input.outcomes.some(o => o.lead_id === lead.id),
    taskCount: tasks.length, openTaskCount: openTasks.length, owner, nextAction, dueAt,
    economics, gaps }
}
export type EconomicTrace = ReturnType<typeof buildEconomicTrace>
