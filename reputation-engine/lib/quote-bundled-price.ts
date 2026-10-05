import type { QuoteLineItem } from './types'

/** Keep explicit service scope, allocating its revenue within the chosen total. */
export function bundledPriceItems(subtotal: number, services: QuoteLineItem[], details: string): QuoteLineItem[] {
  if (!Number.isFinite(subtotal) || subtotal <= 0) throw new Error('Enter a positive customer price.')
  const serviceTotal = services.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  if (serviceTotal > subtotal) throw new Error('The selected price is less than the separate services. Adjust those services before applying this total.')
  return [{ description: 'Moving Services — Agreed Rate', amount: Math.round((subtotal - serviceTotal) * 100) / 100, details }, ...services]
}
