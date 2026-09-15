import type { CRMQuote } from './types'

export const QUOTE_COMMERCIAL_FIELDS = ['lineItems', 'discountAmount', 'subtotal', 'total', 'priceOverrideTotal', 'priceOverrideReason'] as const

export function quoteEditConflict(current: CRMQuote, updates: Partial<CRMQuote>) {
  const touched = QUOTE_COMMERCIAL_FIELDS.some(key => Object.prototype.hasOwnProperty.call(updates, key))
  if (touched && updates.revision !== (current.revision || 0)) return 'This quote changed in another session. Reload before saving prices or discounts.'
  if (current.priceOverrideTotal && touched && updates.priceOverrideTotal === undefined && updates.lineItems &&
    !updates.lineItems.some(item => /agreed rate/i.test(item.description))) return 'This quote has an agreed price. Explicitly remove the override before replacing it with calculated pricing.'
  return undefined
}

export function finalQuoteMargin(quote: Pick<CRMQuote, 'lineItems' | 'discountAmount'>, cost: number) {
  const gross = quote.lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const revenue = Math.max(0, gross - Math.max(0, Number(quote.discountAmount || 0)))
  return { revenue, marginPct: revenue > 0 ? (revenue - cost) / revenue * 100 : 0 }
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
