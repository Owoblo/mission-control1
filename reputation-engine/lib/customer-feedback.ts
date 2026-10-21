export const feedbackReasons = ['unknown', 'price', 'availability', 'trust', 'communication', 'service_scope', 'competitor', 'diy', 'move_cancelled', 'other'] as const
export const contextFields = ['move_reason', 'priority', 'constraints', 'support_needs', 'communication', 'moving_experience'] as const
export type FeedbackEvidence = { id: string; kind: 'customer_sms' | 'call_transcript' | 'rep_note'; text: string; at: string }
export type FeedbackInsight = { field: typeof contextFields[number]; value: string; sourceId: string; excerpt: string }
export type CustomerFeedback = {
  outcome: 'unknown' | 'won' | 'lost' | 'postponed' | 'cancelled'
  status: 'not_requested' | 'requested' | 'received' | 'declined'
  reason: typeof feedbackReasons[number]
  customerWords: string
  sourceId: string
  competitor: string
  competitorPrice: string
  repNotes: string
  context: FeedbackInsight[]
  reviewedAt?: string
  reviewedBy?: string
  requestedAt?: string
}
export const emptyFeedback = (): CustomerFeedback => ({ outcome: 'unknown', status: 'not_requested', reason: 'unknown', customerWords: '', sourceId: '', competitor: '', competitorPrice: '', repNotes: '', context: [] })
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid feedback text or length.')
  return value.trim()
}
function option<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error('Invalid feedback selection.')
  return value as T
}
export function validateFeedback(input: unknown, evidence: FeedbackEvidence[]): CustomerFeedback {
  if (!input || typeof input !== 'object') throw new Error('Invalid feedback.')
  const row = input as Record<string, unknown>
  const result: CustomerFeedback = {
    outcome: option(row.outcome, ['unknown', 'won', 'lost', 'postponed', 'cancelled']),
    status: option(row.status, ['not_requested', 'requested', 'received', 'declined']),
    reason: option(row.reason, feedbackReasons), customerWords: text(row.customerWords), sourceId: text(row.sourceId, 200),
    competitor: text(row.competitor, 200), competitorPrice: text(row.competitorPrice, 200), repNotes: text(row.repNotes, 4000), context: [],
  }
  function verify(sourceId: string, excerpt: string) {
    // Manual phone notes are explicitly rep-reported, never verified transcripts.
    if (sourceId === 'manual') { if (!excerpt) throw new Error('Add the words reported by the customer.'); return }
    const source = evidence.find(e => e.id === sourceId)
    if (!source || !excerpt || !source.text.includes(excerpt)) throw new Error('The quoted words must match the selected source. Review the evidence again.')
  }
  if (result.customerWords) verify(result.sourceId, result.customerWords)
  if ((result.sourceId === 'manual' || result.status === 'requested') && !result.repNotes) throw new Error('Add the conversation date, channel, and source in rep notes.')
  if (result.status === 'received' && !result.customerWords) throw new Error('Received feedback needs customer words and a source.')
  if ((result.reason !== 'unknown' || result.competitor || result.competitorPrice) && !result.customerWords) throw new Error('Record supporting customer words before categorizing feedback.')
  if (result.competitor && !result.customerWords.toLowerCase().includes(result.competitor.toLowerCase())) throw new Error('Competitor must appear in the quoted feedback.')
  if (result.competitorPrice && !result.customerWords.includes(result.competitorPrice)) throw new Error('Competitor price must appear in the quoted feedback.')
  if (!Array.isArray(row.context) || row.context.length > 12) throw new Error('Invalid customer context.')
  result.context = row.context.map((entry: Record<string, unknown>) => {
    const item = { field: option(entry.field, contextFields), value: text(entry.value, 500), sourceId: text(entry.sourceId, 200), excerpt: text(entry.excerpt) }
    if (!item.value) throw new Error('Customer context needs a value.')
    verify(item.sourceId, item.excerpt)
    return item
  })
  if (result.context.some(i => i.sourceId === 'manual') && !result.repNotes) throw new Error('Add the conversation date, channel, and source in rep notes.')
  return result
}
export function feedbackQuestion(feedback: CustomerFeedback, suppressed = false): string | null {
  if (suppressed || feedback.status === 'declined' || feedback.status === 'requested' || feedback.status === 'received') return null
  if (feedback.requestedAt) return null
  if (feedback.outcome === 'won') return 'Thank you for choosing us. What mattered most in your decision, and is there anything we could have made easier? Honest feedback is welcome.'
  if (feedback.outcome !== 'lost') return null
  return 'Thanks for letting us know. If you’re comfortable sharing, what was the main reason you decided not to move with us? No obligation to answer — honest feedback helps us improve.'
}
export function summarizeFeedback(rows: { market: string; feedback: CustomerFeedback }[]) {
  const reasons: Record<string, number> = {}, markets: Record<string, number> = {}
  for (const { market, feedback } of rows) {
    markets[market || 'Unknown'] = (markets[market || 'Unknown'] || 0) + 1
    if (feedback.status === 'received') reasons[feedback.reason] = (reasons[feedback.reason] || 0) + 1
  }
  return { reviewed: rows.length, received: rows.filter(r => r.feedback.status === 'received').length,
    requestedCohort: rows.filter(r => r.feedback.requestedAt).length,
    requestedResponses: rows.filter(r => r.feedback.requestedAt && r.feedback.status === 'received').length,
    awaiting: rows.filter(r => r.feedback.status === 'requested').length, declined: rows.filter(r => r.feedback.status === 'declined').length,
    won: rows.filter(r => r.feedback.outcome === 'won').length, lost: rows.filter(r => r.feedback.outcome === 'lost').length,
    unknownOutcome: rows.filter(r => r.feedback.outcome === 'unknown').length, reasons, markets }
}
