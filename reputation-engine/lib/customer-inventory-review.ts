import type { CRMLead, InventoryItem } from './types'

export function inventoryReviewFingerprint(inventory: InventoryItem[] = []) {
  return JSON.stringify(inventory.filter(item => item.included !== false).map(item => [
    item.name || item.item, item.qty || 1, !!item.nameNeedsConfirmation, !!item.quantityNeedsConfirmation,
    item.customerDescription || '',
  ]))
}

export function inventoryMeasurementIssues(inventory: InventoryItem[] = []) {
  return inventory.filter(item => item.included !== false && (
    !Number.isFinite(Number(item.cubicFeet)) || Number(item.cubicFeet) <= 0 ||
    !Number.isFinite(Number(item.weightLbs)) || Number(item.weightLbs) <= 0 ||
    item.nameNeedsConfirmation || item.quantityNeedsConfirmation
  ))
}

/** A plain list for SMS and paste-based inventory tools; never invent quantities or measurements. */
export function buildCustomerInventoryList(inventory: InventoryItem[] = []) {
  return inventory.filter(item => item.included !== false).map(item => {
    const name = item.name || item.item || 'Item'
    const quantity = item.quantityNeedsConfirmation ? 'Quantity to confirm' : `${Math.max(1, Number(item.qty || 1))} x`
    const clarification = item.nameNeedsConfirmation
      ? ` (please confirm: "${item.customerDescription || name}")` : ''
    return `${quantity} ${name}${clarification}${item.size ? `, ${item.size}` : ''}`
  }).join('\n')
}

export function buildCustomerInventoryReviewMessage(lead: CRMLead) {
  const firstName = (lead.name || 'there').trim().split(/\s+/)[0]
  return `Thanks, ${firstName}. Here is the moving list I have:\n\n${buildCustomerInventoryList(lead.inventory)}\n\nPlease correct any names or quantities, and add anything missing, including boxes and smaller items. For any unclear item, tell us what it is (a photo also works). If the list is complete and correct, reply YES.`
}

export function isInventoryListConfirmation(message: string) {
  return /^(?:yes|yep|yeah|correct|confirmed|that'?s (?:all|right|correct)|all correct|looks (?:good|right)|nothing else|no other items|no more items)[.!\s]*$/i.test(message.trim())
}

export function requestsInventoryQuote(message: string) {
  return /\b(?:quote|estimate|price|pricing)\b/i.test(message) && !/\b(?:don't|do not|not ready|cancel)\b/i.test(message)
}

export function planCustomerInventoryReply(lead: CRMLead, message: string, now: string) {
  if (!(lead.inventory || []).some(item => item.customerDescription)) return null
  const fingerprint = inventoryReviewFingerprint(lead.inventory)
  const review = lead.smsInventoryReview || {}
  const unresolved = (lead.inventory || []).filter(item => item.included !== false && (item.nameNeedsConfirmation || item.quantityNeedsConfirmation))
  const currentRequest = review.requestedFingerprint === fingerprint
  // An explicit pricing request moves work to a person even if the scope is not
  // complete. It must not be mislabeled as customer confirmation.
  if (requestsInventoryQuote(message) || (currentRequest && isInventoryListConfirmation(message))) {
    const confirmed = currentRequest && isInventoryListConfirmation(message) && !unresolved.length
    return {
      handoff: true,
      review: { ...review, ...(confirmed ? { confirmedFingerprint: fingerprint, confirmedAt: now } : {}) },
      body: unresolved.length
        ? `Thanks. I have your list and have flagged the unclear items for our coordinator to confirm with you before pricing. They will review the move details and prepare your quote.`
        : `Thanks. ${confirmed ? 'Your item list is confirmed.' : 'I have your item list and quote request.'} Our coordinator will review the move details to prepare your quote.`,
    }
  }
  if (review.confirmedFingerprint === fingerprint) return null
  if (currentRequest) return null
  return {
    handoff: false,
    review: { requestedFingerprint: fingerprint, requestedAt: now },
    body: buildCustomerInventoryReviewMessage(lead),
  }
}
