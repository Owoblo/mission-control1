import type { CRMQuote } from './types'

const COMMERCIAL_KEYS = ['lineItems', 'discountAmount', 'discountLabel', 'subtotal', 'hst', 'total', 'deposit', 'balance'] as const
const ONTARIO_HST_RATE = 0.13

export type OntarioPriceOverrideMode = 'plus_hst' | 'hst_included'

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function splitOntarioHstInclusiveTotal(value: number) {
  const total = Math.max(0, roundMoney(Number(value || 0)))
  const subtotal = roundMoney(total / (1 + ONTARIO_HST_RATE))
  const hst = roundMoney(total - subtotal)
  return { subtotal, hst, total }
}

export function resolveOntarioPriceOverride(value: number, mode: OntarioPriceOverrideMode) {
  const enteredAmount = Math.max(0, roundMoney(Number(value || 0)))
  if (mode === 'hst_included') return splitOntarioHstInclusiveTotal(enteredAmount)
  const subtotal = enteredAmount
  const hst = roundMoney(subtotal * ONTARIO_HST_RATE)
  return { subtotal, hst, total: roundMoney(subtotal + hst) }
}

/** Keep direct-price metadata aligned with the customer-facing total. */
export function synchronizeQuotePriceOverride(
  current: Pick<Partial<CRMQuote>, 'priceOverrideTotal'>,
  updates: Partial<CRMQuote>,
): Partial<CRMQuote> {
  const pricingTouched = ['lineItems', 'discountAmount', 'subtotal', 'hst', 'total'].some(key =>
    Object.prototype.hasOwnProperty.call(updates, key)
  )
  const hasExistingOverride = Number(current.priceOverrideTotal || 0) > 0
  const overrideExplicitlyUpdated = Object.prototype.hasOwnProperty.call(updates, 'priceOverrideTotal')
  if (!pricingTouched || !hasExistingOverride || overrideExplicitlyUpdated) return updates

  return { ...updates, priceOverrideTotal: roundMoney(Number(updates.total || 0)) }
}

export function getQuoteCommercialArithmeticError(quote: Pick<CRMQuote, 'lineItems' | 'discountAmount' | 'subtotal' | 'hst' | 'total'> & Pick<Partial<CRMQuote>, 'priceOverrideTotal'>) {
  const lineSubtotal = (quote.lineItems || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const subtotal = Math.max(0, roundMoney(lineSubtotal - Number(quote.discountAmount || 0)))
  const hst = roundMoney(subtotal * ONTARIO_HST_RATE)
  const total = roundMoney(subtotal + hst)
  const differs = (actual: number, expected: number) => Math.abs(roundMoney(Number(actual || 0)) - expected) > 0.01

  if (differs(quote.subtotal, subtotal)) return `Saved subtotal must equal priced lines less discounts (${subtotal.toFixed(2)}).`
  if (differs(quote.hst, hst)) return `HST must be calculated once from the pre-tax subtotal (${hst.toFixed(2)}).`
  if (differs(quote.total, total)) return `Total including HST must equal subtotal plus HST (${total.toFixed(2)}).`
  if (Number(quote.priceOverrideTotal || 0) > 0 && differs(Number(quote.priceOverrideTotal), total)) {
    return `The agreed customer override total must match the total including HST (${total.toFixed(2)}).`
  }
  return null
}

function normalizeCommercialValue(key: typeof COMMERCIAL_KEYS[number], value: unknown) {
  if (key === 'lineItems') {
    return (Array.isArray(value) ? value : []).map(item => {
      const line = item as { description?: string; details?: string; amount?: number }
      return { description: (line.description || '').trim(), details: (line.details || '').trim(), amount: Math.round(Number(line.amount || 0) * 100) / 100 }
    })
  }
  if (key === 'discountLabel') return String(value || '').trim()
  return Math.round(Number(value || 0) * 100) / 100
}

export function hasCustomerFacingCommercialSnapshot(quote?: Partial<CRMQuote> | null) {
  return Boolean(quote && (quote.sentAt || quote.viewedAt || quote.acceptedAt || quote.respondedAt || ['sent', 'viewed', 'accepted', 'invoiced', 'declined'].includes(String(quote.status))))
}

export function quoteCommercialSnapshotChanged(current: CRMQuote, updates: Partial<CRMQuote>) {
  return COMMERCIAL_KEYS.some(key =>
    Object.prototype.hasOwnProperty.call(updates, key) &&
    JSON.stringify(normalizeCommercialValue(key, current[key])) !== JSON.stringify(normalizeCommercialValue(key, updates[key]))
  )
}

export function quoteDeliveryBlockReason(quote: Pick<CRMQuote, 'status' | 'respondedAt'>) {
  if (quote.status === 'declined') return 'This customer declined the quote. Create an explicit revision and obtain permission before sending another quote.'
  if (quote.status === 'sent' && quote.respondedAt) return 'This quote already has a customer response and cannot be resent as an active quote without explicit reactivation.'
  return null
}

export function hasDeliverableQuotePricing(quote?: Partial<CRMQuote> | null) {
  return Boolean(
    quote &&
    Number(quote.total || 0) > 0 &&
    Array.isArray(quote.lineItems) &&
    quote.lineItems.length > 0 &&
    quote.lineItems.some(item => Number(item.amount || 0) > 0),
  )
}

export function quotePricingUpdateWouldEraseSnapshot(
  current: CRMQuote,
  updates: Partial<CRMQuote>,
) {
  const pricingTouched = COMMERCIAL_KEYS.some(key => Object.prototype.hasOwnProperty.call(updates, key))
  if (!pricingTouched || !hasDeliverableQuotePricing(current)) return false
  return !hasDeliverableQuotePricing({ ...current, ...updates })
}
