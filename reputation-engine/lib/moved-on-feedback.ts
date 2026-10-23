import type { CustomerFeedback } from './customer-feedback'

export function detectMovedOnIntent(message?: string): boolean {
  if (!message) return false
  return /\b(already (booked|hired|found|went with)|booked (with|someone else|another)|hired (someone|another)|found (someone|another mover|another company)|went with (someone|another|a different)|(?:we|i|we've|we have|i've|i have) moved on(?: with)? (?:someone|another|a different)|chose (someone|another|a different)|got a better (deal|price|quote)|not moving with you|we moved on|i moved on|no longer need|don'?t need (movers|moving)|do not need (movers|moving))\b/i.test(message)
}

export function detectLostFeedbackDetail(message?: string): boolean {
  if (!message) return false
  const text = message.trim()
  if (!text) return false
  if (/\b(price|expensive|cheaper|cheap|cost|quote|deal|discount|timing|availability|available|date|schedule|trust|review|referral|friend|family|service|response|responsiveness|responsive|faster|follow[- ]?up|deposit|insurance|licensed|cash|ancient|u-?haul|two men|amj|metropolitan|atlas|allied|northstar|better)\b/i.test(text)) return true
  return /\b(because|due to|too high|lower rate|better rate|moving (?:was |is )?cancelled|move (?:was |is )?cancelled|doing it (?:myself|ourselves))\b/i.test(text)
}

export function shouldRequestMovedOnFeedback(input: {
  message: string
  feedback?: CustomerFeedback
  booked: boolean
  doNotContact: boolean
  optedOut: boolean
  alreadyAsked: boolean
}): boolean {
  const feedback = input.feedback
  return Boolean(
    !input.booked && !input.doNotContact && !input.optedOut && !input.alreadyAsked &&
    !feedback?.requestReservedAt && !feedback?.requestedAt && !['requested', 'received', 'declined'].includes(feedback?.status || '') &&
    detectMovedOnIntent(input.message) && !detectLostFeedbackDetail(input.message)
  )
}
