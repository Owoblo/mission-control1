export const INTERACTION_ACTORS = ['prospect', 'partner', 'existing_customer', 'employee', 'vendor', 'spam_scam', 'wrong_number', 'unknown'] as const
export const INTERACTION_INTENTS = ['quote_request', 'booking_request', 'moving_question', 'existing_customer_support', 'partnership_inquiry', 'referral', 'payment_issue', 'employee_internal', 'spam', 'wrong_recipient', 'no_commercial_intent', 'unknown'] as const
export const INTERACTION_DISPOSITIONS = ['not_a_lead', 'lead_candidate', 'qualified_lead', 'customer', 'partner_opportunity', 'support_case'] as const
export type InteractionDisposition = typeof INTERACTION_DISPOSITIONS[number]
export interface InteractionClassification {
  actor: typeof INTERACTION_ACTORS[number]
  intent: typeof INTERACTION_INTENTS[number]
  disposition: InteractionDisposition
  confidence: number
  reason: string
  evidence?: {
    movingIntent: boolean
    serviceableLocation: boolean
    realIdentity: boolean
    usableContact: boolean
    plausibleOpportunity: boolean
    location: string
  }
}

// Text alone is evidence for review, never proof of identity or serviceability.
export function classifyInteraction(message = ''): InteractionClassification {
  const moving = /\b(move|moving|movers|relocation)\b/i.test(message)
  const intent = moving && /\b(quote|estimate|price|cost)\b/i.test(message) ? 'quote_request'
    : moving && /\b(book|booking|reserve)\b/i.test(message) ? 'booking_request'
      : moving ? 'moving_question' : 'unknown'
  return { actor: 'unknown', intent, disposition: 'lead_candidate', confidence: moving ? 0.5 : 0,
    reason: moving ? 'Moving inquiry detected; identity and service fit need verification.' : 'Insufficient evidence; retained for review.' }
}

export function countsAsCommercialLead(lead: { commercialDisposition?: InteractionDisposition }) {
  return lead.commercialDisposition === 'qualified_lead' || lead.commercialDisposition === 'customer'
}
