import type { CRMQuote } from './types'
import { quoteCommercialSnapshotChanged } from './quote-pricing-safety'
export interface QuoteVersionSnapshot {
  version: number
  savedAt: string
  reason: string
  changedBy: string
  quote: Pick<CRMQuote, 'number' | 'moveDate' | 'lineItems' | 'customerScope' | 'subtotal' | 'hst' | 'total' | 'deposit' | 'balance' | 'discountAmount' | 'status' | 'originAddress' | 'destAddress'>
}
export function customerQuoteChanged(current: CRMQuote, updates: Partial<CRMQuote>) {
  const comparableScope = (scope: CRMQuote['customerScope']) => scope ? { ...scope, capturedAt: undefined } : scope
  return quoteCommercialSnapshotChanged(current, updates) ||
    (updates.customerScope !== undefined && JSON.stringify(comparableScope(updates.customerScope)) !== JSON.stringify(comparableScope(current.customerScope)))
}
export function preserveQuoteVersion(current: CRMQuote, reason: string, actor: string) {
  const { number, moveDate, lineItems, customerScope, subtotal, hst, total, deposit, balance, discountAmount, status, originAddress, destAddress } = current
  const snapshot: QuoteVersionSnapshot = { version: current.commercialVersion || 1, savedAt: new Date().toISOString(), reason, changedBy: actor, quote: { number, moveDate, lineItems, customerScope, subtotal, hst, total, deposit, balance, discountAmount, status, originAddress, destAddress } }
  return { commercialVersion: (current.commercialVersion || 1) + 1, versionHistory: [...(current.versionHistory || []), structuredClone(snapshot)] }
}
export function isCurrentQuoteVersion(quote: Pick<CRMQuote, 'commercialVersion'>, submitted?: number) {
  return (submitted ?? 1) === (quote.commercialVersion || 1)
}
