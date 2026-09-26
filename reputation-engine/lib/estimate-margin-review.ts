import type { QuoteLineItem } from './types'

/** Acknowledgement follows the financial decision, not React object identity. */
export function marginReviewKey(input: {
  quoteId?: string; subtotal: number; totalCost: number; minimumPrice: number
  pendingInventory: string; lineItems: QuoteLineItem[]
}) {
  const cents = (value: number) => Math.round(Number(value || 0) * 100)
  return JSON.stringify([
    input.quoteId, cents(input.subtotal), cents(input.totalCost), cents(input.minimumPrice),
    input.pendingInventory,
    input.lineItems.map(line => [line.description, cents(line.amount)]),
  ])
}
