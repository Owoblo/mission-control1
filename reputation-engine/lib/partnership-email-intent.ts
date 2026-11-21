/** Recommendations only: classification never authorizes a send or a commitment. */
export type PartnershipEmailIntent = 'interested' | 'card_or_info' | 'quote' | 'referral' | 'vendor_registration' | 'future_interest' | 'later_date' | 'negative' | 'automatic' | 'unknown'

export type PartnershipEmailIntentMetadata = {
  intent: PartnershipEmailIntent
  evidence: string | null
  requestedDateLiteral: string | null
  recommendedAction: string
  requiresHumanReview: true
  mayAutoSend: false
}

const actions: Record<PartnershipEmailIntent, string> = {
  interested: 'Review the stated interest and prepare a contextual reply in the existing thread. Confirm scope before making commitments.',
  card_or_info: 'Prepare the requested digital card or information for review. Check the correct brand, city and partnership number before replying.',
  quote: 'Review the requested work and prepare clarification questions or a quote draft. Do not invent pricing, availability or a booking.',
  referral: 'Verify the referred person or department and their role. Preserve the referral context before proposing contact.',
  vendor_registration: 'Review the vendor or procurement requirements and verify any destination independently before preparing registration materials.',
  future_interest: 'Record the expressed future interest. Review a suitable follow-up without inventing a date or assuming a commitment.',
  later_date: 'Review the recipient’s literal timing request and timezone before scheduling a follow-up. No date has been inferred or scheduled.',
  negative: 'Review the objection and existing suppression state. Do not treat a negative response as permission for another pitch.',
  automatic: 'Review the system notice or absence message. Do not count it as a human positive reply or automatically contact alternate people.',
  unknown: 'Read the current reply in context before choosing a next action; no clear intent was established.',
}

function result(intent: PartnershipEmailIntent, evidence: string | null, requestedDateLiteral: string | null = null): PartnershipEmailIntentMetadata {
  return { intent, evidence, requestedDateLiteral, recommendedAction: actions[intent], requiresHumanReview: true, mayAutoSend: false }
}

// Retain dates exactly as written. This is not date parsing or scheduling.
const dateLiteral = /\b(?:today|tomorrow|(?:next|this)\s+(?:week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+(?:morning|afternoon|evening))?|(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|in\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:days?|weeks?|months?|years?))\b/i
const negative = /\b(?:not interested|no (?:thanks|thank you)|not (?:a |the )?(?:good )?fit|no need|do not need|don't need|do not want|don't want|not looking|already (?:have|use|work with)|we(?:'re| are) (?:all )?(?:good|covered|not interested)|decline|not for us)\b/i
const negated = /\b(?:not|never|cannot|can't|don't|do not|won't|will not|no need|without|not yet)\b/i

export function classifyEmailIntent(kind: string, reply: string): PartnershipEmailIntentMetadata {
  // Keep the canonical kind authoritative for suppression and system events.
  if (kind === 'opt_out') return { ...result('negative', reply.trim().slice(0, 500) || null), recommendedAction: 'Stop outreach and retain the suppression. Do not send a follow-up.' }
  if (['automatic_reply', 'verification', 'verification_pending_review', 'delivery_failure'].includes(kind)) {
    return { ...result('automatic', reply.trim().slice(0, 500) || null), ...(kind === 'delivery_failure' ? { recommendedAction: 'Hold this address and research a replacement. Do not retry or count this as a human reply.' } : {}) }
  }

  // Do not classify quoted copy, signatures, forwarded text or reported requests.
  const current = reply.split(/(?:^|\s)(?:On .{8,200} wrote:|From:\s|Begin forwarded message:|[-_]{2,}\s*(?:Forwarded|Original) message|You wrote:|You said:)/i)[0]
    .replace(/<blockquote\b[^>]*>[\s\S]*?(?:<\/blockquote>|$)/gi, '')
    .replace(/\n\s*(?:--\s*\n|(?:best(?: regards)?|kind regards|regards|sincerely)[,!]?\s*\n|sent from my [^\n]*(?:\n|$))[\s\S]*$/i, '')
  const sentences = current.split(/\n+|(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s && !/^(?:>|[“"]|you (?:wrote|said|asked)|your (?:email|message) (?:says|said)|(?:he|she|they) (?:said|wrote|asked))/i.test(s))
  const candidates: Array<{ intent: PartnershipEmailIntent; evidence: string; date?: string }> = []
  let objection: string | undefined
  for (const sentence of sentences) {
    const text = sentence.replace(/[“"][^”"]*[”"]/g, '').replace(/(?:^|\s)'[^']+'(?=\s|[,.!?]|$)/g, ' ')
    if (negative.test(text)) objection ||= sentence
    // Qualifying objections are left for a person, even when a request follows.
    if (negated.test(text)) continue
    let intent: PartnershipEmailIntent | undefined
    let date: string | undefined
    if (/\b(?:follow up|check back|reach (?:back )?out|contact (?:me|us)|call (?:me|us)|email (?:me|us)|try again|reconnect|circle back)\b/i.test(text) && (date = text.match(dateLiteral)?.[0])) intent = 'later_date'
    else if (/\b(?:vendor|supplier|procurement)\b/i.test(text) && /\b(?:register|registration|portal|onboard|onboarding|application|form|apply|approved list)\b/i.test(text)) intent = 'vendor_registration'
    else if (/\b(?:need|request|want|looking for|get)\b.{0,70}\b(?:quote|quotation|estimate|pricing|rates|price list)\b|(?:^|\b(?:please|can you|could you|would you|will you)\s+)(?:send|provide|prepare|give)\b.{0,70}\b(?:quote|quotation|estimate|pricing|rates|price list)\b|\b(?:can|could|would) you quote\b|\b(?:how much|what (?:are|is) (?:your |the )?(?:rates|price|pricing|cost))\b/i.test(text)) intent = 'quote'
    else if (/\b(?:contact|email|call|speak (?:with|to)|reach out to)\s+(?:our|the)\s+(?:facilities|operations|procurement|property|office|general|branch|HR|human resources|manager|owner|team|department)\b|\b(?:forwarded|forwarding|passed (?:this|your (?:email|message)))\b.{0,70}\b(?:to|team|department)\b/i.test(text)
      || /\b(?:contact|email|call|speak (?:with|to)|reach out to)\s+(?!(?:me|us)\b)(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[\w.+-]+@[\w.-]+)/.test(text)) intent = 'referral'
    else if (/(?:^|\b(?:please|can you|could you|would you|will you)\s+)(?:send|share|email|forward|provide)\b.{0,60}\b(?:card|details|information|info|brochure|services|service list)\b|\b(?:can i get|could i get|i(?:'d| would) like)\b.{0,40}\b(?:card|details|information|info|brochure)\b/i.test(text)) intent = 'card_or_info'
    else if (/\b(?:keep (?:you|your (?:card|details|information|info)) (?:in mind|on (?:file|hand))|(?:may|might|could) (?:need|use|work with)|(?:interested|need|use).{0,50}(?:future|later|down the road))\b/i.test(text)) intent = 'future_interest'
    else if (/\b(?:(?:we|i)(?:'re|'m| are| am)? (?:definitely |very )?interested|(?:we|i)(?:'d| would) (?:love|like) to (?:work|partner|connect)|(?:sounds|that sounds) (?:good|great)|happy to (?:work|partner|connect))\b/i.test(text)) intent = 'interested'
    if (intent) candidates.push({ intent, evidence: sentence, date })
  }
  if (objection && candidates.length) return result('unknown', current.trim().slice(0, 500))
  if (objection) return result('negative', objection)
  // Multiple different asks need human context; avoid silently choosing one.
  const intents = new Set(candidates.map(c => c.intent))
  if (intents.size > 1) return result('unknown', current.trim().slice(0, 500))
  if (candidates.length) return result(candidates[0].intent, candidates[0].evidence, candidates[0].date || null)
  return result('unknown', null)
}
