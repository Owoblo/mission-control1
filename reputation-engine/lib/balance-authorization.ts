import { getQuotePaidSoFar } from './server/job-billing'
import type { CRMLead, CRMQuote } from './types'

export const BALANCE_AUTHORIZATION_CONSENT_VERSION = '2026-08-18'

export function getOutstandingBalance(quote: CRMQuote, lead?: CRMLead | null) {
  return Math.max(0, Math.round((Number(quote.total || 0) - getQuotePaidSoFar(quote, lead).totalPaid) * 100) / 100)
}

export function isBalanceAuthorizationLive(quote: CRMQuote, requiredAmount = 0, now = Date.now()) {
  if (quote.balanceAuthorizationStatus !== 'authorized' && quote.balanceAuthorizationStatus !== 'capture_due') return false
  if (Number(quote.balanceAuthorizationAmount || 0) + 0.001 < requiredAmount) return false
  const expiresAt = quote.balanceAuthorizationCaptureBefore ? new Date(quote.balanceAuthorizationCaptureBefore).getTime() : 0
  return !expiresAt || expiresAt > now
}

export function deriveBalanceAuthorizationState(quote: CRMQuote, lead?: CRMLead | null) {
  const outstanding = getOutstandingBalance(quote, lead)
  const live = isBalanceAuthorizationLive(quote, outstanding)
  return {
    outstanding,
    live,
    dispatchCleared: outstanding <= 0 || live,
    expiresAt: quote.balanceAuthorizationCaptureBefore,
    authorizedAmount: Number(quote.balanceAuthorizationAmount || 0),
  }
}
