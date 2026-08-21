import type { CRMQuote } from './types'

export function isProvisionalQuoteScope(quote: Pick<CRMQuote, 'scopeStatus' | 'moveDescription' | 'internalNotes'>) {
  if (quote.scopeStatus === 'provisional') return true
  return /^Provisional estimate\b/i.test(quote.moveDescription?.trim() || '') || /\bPROVISIONAL QUOTE\b/i.test(quote.internalNotes || '')
}
