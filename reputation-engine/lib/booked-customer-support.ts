export type BookedCustomerSupportIntent =
  | 'box_delivery'
  | 'damage_or_complaint'
  | 'schedule'
  | 'payment_or_receipt'
  | 'change_request'
  | 'access_or_crew'
  | 'general'

export function sameNormalizedSmsBody(left?: string | null, right?: string | null) {
  const normalize = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedLeft = normalize(left)
  return !!normalizedLeft && normalizedLeft === normalize(right)
}

export function customerReplyRequiresHuman(input: {
  isBookedCustomer: boolean
  repWorkflowReason?: string | null
}) {
  return input.isBookedCustomer || !!input.repWorkflowReason
}

export function detectBookedCustomerSupportIntent(message?: string): BookedCustomerSupportIntent {
  const text = (message || '').trim().toLowerCase()

  if (/\b(box|boxes|packing supplies?|materials?)\b/.test(text) && /\b(deliver\w*|arriv\w*|drop\w*|bring|receiv\w*|didn'?t get|not get|still waiting|overdue|late)\b/.test(text)) {
    return 'box_delivery'
  }
  if (/\b(damag|broken|scratch|missing|lost|complain|unhappy|upset|problem|issue)\b/.test(text)) {
    return 'damage_or_complaint'
  }
  if (/\b(when|what time|arrival|arrive|schedule|reschedule|date|day|late|delay)\b/.test(text)) {
    return 'schedule'
  }
  if (/\b(payment|paid|deposit|balance|receipt|invoice|refund|charge|card|e-?transfer)\b/.test(text)) {
    return 'payment_or_receipt'
  }
  if (/\b(add|remove|change|update|different|extra|no longer|instead|another stop|address)\b/.test(text)) {
    return 'change_request'
  }
  if (/\b(park|parking|truck|crew|mover|entrance|door|elevator|stairs|loading|access|hall|unit|apartment)\b/.test(text)) {
    return 'access_or_crew'
  }
  return 'general'
}
