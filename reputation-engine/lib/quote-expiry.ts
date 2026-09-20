import type { CRMQuote } from './types'

// A quote is expired when its validity window (validDays from createdAt, default 30)
// has passed. Quotes in terminal states keep working as receipts/history — expiry
// only blocks new customer actions (view-as-bookable, accept, decline).
export function isQuoteExpired(quote: Pick<CRMQuote, 'status' | 'createdAt' | 'validDays' | 'acceptedAt'>): boolean {
  if (quote.status === 'accepted' || quote.status === 'invoiced' || quote.status === 'declined' || quote.acceptedAt) return false
  if (!quote.createdAt) return false
  const created = new Date(quote.createdAt.length === 10 ? `${quote.createdAt}T12:00:00` : quote.createdAt)
  if (Number.isNaN(created.getTime())) return false
  const validDays = quote.validDays && quote.validDays > 0 ? quote.validDays : 30
  const expiresAt = new Date(created)
  expiresAt.setDate(expiresAt.getDate() + validDays)
  return Date.now() > expiresAt.getTime()
}

// Calendar date the quote stops being bookable (ISO date, YYYY-MM-DD).
export function quoteExpiryDate(quote: Pick<CRMQuote, 'createdAt' | 'validDays'>): string | null {
  if (!quote.createdAt) return null
  const created = new Date(quote.createdAt.length === 10 ? `${quote.createdAt}T12:00:00` : quote.createdAt)
  if (Number.isNaN(created.getTime())) return null
  const validDays = quote.validDays && quote.validDays > 0 ? quote.validDays : 30
  const expiresAt = new Date(created)
  expiresAt.setDate(expiresAt.getDate() + validDays)
  return expiresAt.toISOString().slice(0, 10)
}
