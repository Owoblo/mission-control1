import type { CRMQuote } from './types'
import { hasCustomerFacingCommercialSnapshot, quoteCommercialSnapshotChanged } from './quote-pricing-safety'
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

export function quoteRevisionError(current: CRMQuote, updates: Partial<CRMQuote>, reason?: string) {
  return hasCustomerFacingCommercialSnapshot(current) && customerQuoteChanged(current, updates) && (reason?.trim().length || 0) < 8
    ? 'Add a revision reason (at least 8 characters) before saving changes to this customer’s price or scope.'
    : null
}
