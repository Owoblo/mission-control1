export type PartnershipLeadSignal = {
  is_lead: boolean
  score: number
  priority: 'normal' | 'high' | 'urgent'
  kind: 'direct_job' | 'client_need' | 'quote_request' | 'schedule_request' | 'none'
  rationale: string
}

// Service evidence and an affirmative, current request must occur together.
// A quote, referral, staging profession or photography scope is not a move.
const SERVICE_RE = /\b(?:pick.?up|moved?|moving|movers?|relocat(?:e|ion)|(?:load|unload)(?:ing)?|furniture (?:delivery|handling|installation|rearrang(?:e|ing)))\b/i
const REQUEST_RE = /\b(?:(?:need|needs|require|requires|looking for)\b.{0,60}\b(?:assistance|help|movers?|moving|move|relocation|furniture|load|unload)|(?:can|could|would) you\b.{0,50}\b(?:move|deliver|load|unload|relocate)|(?:i am|i'm|we are|we're|client is) moving|(?:have|has) (?:a |an )?(?:client|customer) who needs|how much (?:would|will|does|do)\b.{0,35}\b(?:cost|charge|be)|what would\b.{0,35}\b(?:cost|charge))\b/i
const CONCRETE_RE = /\b(?:today|tomorrow|next (?:week|month|monday|tuesday|wednesday|thursday|friday)|this (?:week|month)|closing|bedrooms?|sofa|couch|piano|furniture|apartment|house|office|warehouse|coming up|scheduled)\b|\b\d+\s+\w+\s+(?:street|st|road|rd|avenue|ave)\b/i
const CLIENT_RE = /\bclient|customer\b/i
const QUOTE_RE = /\b(?:quote|estimate|pricing|price|rate|cost|how much|what do you charge)\b/i
const SCHEDULE_RE = /\b(?:available|availability|schedule|scheduling|book|booking|when can|what day|what time|asap|urgent|tomorrow|this week|next week)\b/i

export function detectPartnershipLeadSignal(text: string | null | undefined): PartnershipLeadSignal {
  let value = String(text || '').replace(/^\s*(?:inbound sms|historical email):\s*/i, '').replace(/\s+/g, ' ').trim()
  const reaction = value.search(/\b(?:liked|loved|reacted)\b/i)
  if (reaction >= 0 && /[“\"]/.test(value.slice(reaction))) value = value.slice(0, reaction).trim()
  const quoteStart = value.search(/[“\"]/)
  if (quoteStart >= 0 && !/[A-Za-z]{3}/.test(value.slice(0, quoteStart))) value = value.slice(0, quoteStart).trim()
  if (!value) return { is_lead: false, score: 0, priority: 'normal', kind: 'none', rationale: 'No reply text.' }

  // Evaluate clauses independently so a hypothetical referral or unrelated
  // photo quote cannot borrow moving vocabulary elsewhere in the message.
  const sentences = value.split(/(?<=[.!?;])\s+|\n+/)
  const clauses = sentences.map((sentence, index) => sentence + ' ' + (sentences[index + 1] || ''))
  const actionable = clauses.filter(clause => {
    if (/\b(?:if|whenever|in case)\b|\b(?:ever|someday|keep (?:you|your|this)|future referrals?|when (?:i|we) (?:have|get)|(?:always|usually|often|regularly) need)\b/i.test(clause)) return false
    if (/\b(?:don't|do not|doesn't|not|no longer)\s+(?:currently\s+)?(?:need|require|move|moving|interested)|\b(?:already have|have our own)\s+(?:a\s+)?movers?|\bwrong number\b/i.test(clause)) return false
    return SERVICE_RE.test(clause) && REQUEST_RE.test(clause) &&
      (CONCRETE_RE.test(clause) || CLIENT_RE.test(clause) || /\b(?:need|needs|require|requires)\b/i.test(clause))
  })
  if (!actionable.length) return { is_lead: false, score: 0, priority: 'normal', kind: 'none', rationale: 'No affirmative current moving or furniture-handling request. Keep in Partnerships for context review.' }
  const hasClient = actionable.some(clause => CLIENT_RE.test(clause))
  const hasQuote = QUOTE_RE.test(value)
  const hasSchedule = SCHEDULE_RE.test(value)
  const score = 4 + Number(hasClient) + Number(hasQuote) + Number(hasSchedule)
  const kind = hasQuote ? 'quote_request' : hasSchedule ? 'schedule_request' : hasClient ? 'client_need' : 'direct_job'
  const priority = /\b(?:urgent|asap|today|tomorrow|this week|closing|deadline)\b/i.test(value) ? 'urgent' : hasQuote || hasSchedule ? 'high' : 'high'
  return {
    is_lead: true,
    score,
    priority,
    kind,
    rationale: hasClient ? 'Reply identifies a client or client job that may need moving or staging support.' : hasQuote ? 'Reply asks for pricing or an estimate tied to a service need.' : 'Reply indicates a concrete moving, staging, or scheduling need.',
  }
}
