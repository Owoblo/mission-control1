export function isPartnershipAutomatedAcknowledgement(value?: string | null) {
  const text = (value || '').replace(/^\s*Inbound (?:SMS|email):\s*/i, '').trim()
  if (!text || /\?|\b(?:please (?:send|email|call|text)|send (?:me|us|it|the card)|do not contact|wrong number|unsubscribe|stop)\b/i.test(text)) return false

  const receipt = /\b(?:we (?:have )?received your (?:message|text|inquiry)|your (?:message|text|inquiry) (?:has been|was) received)\b/i
  const followUp = /\b(?:we will|we'll|and will|(?:a member of )?our team will) (?:get back to you|respond|be in touch)\b/i
  return receipt.test(text) && followUp.test(text)
}
