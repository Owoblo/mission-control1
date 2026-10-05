import { computeQuoteTotals } from './sales'
import type { CRMQuote, QuoteLineItem } from './types'

export function resolveQuoteDraftPricing(quote: CRMQuote, items: QuoteLineItem[], discount: number, depositRate: number, customerFacing: boolean, allowRevision = false) {
  const proposedOverride = items.find(item => item.description === 'Moving Services — Agreed Rate')
  const proposedTotals = computeQuoteTotals(items, depositRate, discount)
  const hasExplicitPriceRevision = Boolean(customerFacing && (proposedOverride || allowRevision) && (
    Math.abs(Number(proposedTotals.total || 0) - Number(quote.total || 0)) > 0.01 ||
    JSON.stringify(items) !== JSON.stringify(quote.lineItems || []) || discount !== Number(quote.discountAmount || 0)
  ))
  const preserveCustomerFacingPricing = customerFacing && !hasExplicitPriceRevision
  const sourceLineItems = preserveCustomerFacingPricing ? quote.lineItems || [] : items
  const effectiveDiscount = preserveCustomerFacingPricing ? Number(quote.discountAmount || 0) : discount
  const totals = preserveCustomerFacingPricing ? {
    lineItems: quote.lineItems || [], subtotal: quote.subtotal, hst: quote.hst,
    total: quote.total, deposit: quote.deposit, balance: quote.balance,
  } : computeQuoteTotals(sourceLineItems, depositRate, effectiveDiscount)
  const overrideLineItem = sourceLineItems.find(item => item.description === 'Moving Services — Agreed Rate')
  // Older quotes stored the pre-tax override here. Repair metadata to the
  // authoritative saved total without changing the customer's agreed amounts.
  const priceOverrideTotal = preserveCustomerFacingPricing
    ? Number(quote.priceOverrideTotal || 0) > 0 ? totals.total : quote.priceOverrideTotal
    : overrideLineItem ? totals.total : 0
  return { hasExplicitPriceRevision, preserveCustomerFacingPricing, sourceLineItems, effectiveDiscount, totals, overrideLineItem, proposedOverride, priceOverrideTotal }
}
