export type PartnershipLeadSignal = {
  is_lead: boolean
  score: number
  priority: 'normal' | 'high' | 'urgent'
  kind: 'direct_job' | 'client_need' | 'quote_request' | 'schedule_request' | 'none'
  rationale: string
}

const MOVE_RE = /\b(?:move|moving|movers?|relocat(?:e|ion)|load(?:ing)?|unload(?:ing)?)\b/i
const STAGING_RE = /\b(?:stage|staging|stager|furniture rearrang(?:e|ing)|install(?:ation)?|delivery|storage move)\b/i
const CLIENT_RE = /\b(?:my|our|a|the)\s+client(?:s)?\b|\bclient(?:s)?\s+(?:needs?|need|is looking|are looking|wants?|want|asked|ask(?:s)?)\b/i
const JOB_RE = /\b(?:job|project|move|booking|book(?:ing)?|quote|estimate|referral|opportunity|pickup|drop.?off)\b/i
const QUOTE_RE = /\b(?:quote|estimate|pricing|price|rate|cost|how much|what do you charge)\b/i
const SCHEDULE_RE = /\b(?:available|availability|schedule|scheduling|book|booking|when can|what day|what time|asap|urgent|tomorrow|this week|next week)\b/i

export function detectPartnershipLeadSignal(text: string | null | undefined): PartnershipLeadSignal {
  let value = String(text || '').replace(/^\s*(?:inbound sms|historical email):\s*/i, '').replace(/\s+/g, ' ').trim()
  const reaction = value.search(/\b(?:liked|loved|reacted)\b/i)
  if (reaction >= 0 && /[“\"]/.test(value.slice(reaction))) value = value.slice(0, reaction).trim()
  const quoteStart = value.search(/[“\"]/)
  if (quoteStart >= 0 && !/[A-Za-z]{3}/.test(value.slice(0, quoteStart))) value = value.slice(0, quoteStart).trim()
  if (!value) return { is_lead: false, score: 0, priority: 'normal', kind: 'none', rationale: 'No reply text.' }

  const hasMove = MOVE_RE.test(value)
  const hasStaging = STAGING_RE.test(value)
  const hasClient = CLIENT_RE.test(value)
  const hasJob = JOB_RE.test(value)
  const hasQuote = QUOTE_RE.test(value)
  const hasSchedule = SCHEDULE_RE.test(value)
  if (/\b(?:not|won't|will not|willn't)\s+(?:be\s+)?(?:engag|moving forward|interested)|\bno longer need/i.test(value)) {
    return { is_lead: false, score: 0, priority: 'normal', kind: 'none', rationale: 'Reply closes or declines a prior job.' }
  }
  if (/\b(?:drop|leave|send)\s+(?:off\s+)?(?:some\s+)?(?:cards?|flyers?)\b/i.test(value) && !hasQuote && !hasMove && !hasStaging) {
    return { is_lead: false, score: 0, priority: 'normal', kind: 'none', rationale: 'Reply concerns partnership collateral only.' }
  }
  let score = 0
  if (hasClient) score += 2
  if (hasMove || hasStaging) score += 2
  if (hasJob) score += 1
  if (hasQuote) score += 2
  if (hasSchedule) score += 1

  const isLead = (hasClient && (hasMove || hasStaging || hasJob)) ||
    (hasQuote && (hasMove || hasStaging || hasJob)) ||
    (hasStaging && hasJob) ||
    (hasSchedule && (hasMove || hasStaging) && score >= 4)
  if (!isLead) return { is_lead: false, score, priority: 'normal', kind: 'none', rationale: 'No concrete job or client need detected.' }

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
