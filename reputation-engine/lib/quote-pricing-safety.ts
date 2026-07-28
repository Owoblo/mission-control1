import type { CRMQuote } from './types'

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
  const pricingTouched = [
    'lineItems',
    'subtotal',
    'hst',
    'total',
    'deposit',
    'balance',
  ].some(key => Object.prototype.hasOwnProperty.call(updates, key))
  if (!pricingTouched || !hasDeliverableQuotePricing(current)) return false
  return !hasDeliverableQuotePricing({ ...current, ...updates })
}
