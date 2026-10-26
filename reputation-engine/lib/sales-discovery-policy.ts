/** Website operational disclaimers are not customer requests or furniture. */
export function customerInventoryText(message?: string | null) {
  const text = (message || '').replace(/\bNo price,?\s*crew or booking was confirmed by this form\.?/gi, '').trim()
  const notes = text.match(/\bCustomer notes:\s*([\s\S]*)/i)
  return (notes ? notes[1] : text).trim()
}

/** Reject process handoffs and opening-hours deferrals in normal sales replies. */
export function interruptsNormalSalesDiscovery(reply?: string) {
  return /\bcoordinator\b|\b(?:handing|passing|forwarding|transferring)\b.{0,35}\b(?:team|person|rep|representative)\b|\b(?:office|business|working) hours\b|\b(?:office|team)\b.{0,25}\b(?:closed|opens?|opening)\b|\b(?:get back|respond|reply|contact you)\b.{0,30}\b(?:tomorrow|morning|next business day)\b/i.test(reply || '')
}
