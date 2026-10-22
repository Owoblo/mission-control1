import type { CRMLead, CRMQuote } from './types'
const committed = new Set(['booked','completed','customer_success'])
/** Sales confirmation is independent of crew/vehicle readiness. Existing commitments are preserved. */
export function bookingDecision(lead: Pick<CRMLead,'stage'>, quote?: CRMQuote | null) {
  if (committed.has(lead.stage)) return { confirmed:true, reason:'existing_commitment' as const }
  if (!quote || !['accepted','invoiced'].includes(quote.status)) return { confirmed:false, reason:'acceptance_required' as const }
  const required = Number(quote.deposit)
  // Zero-deposit/credit arrangements need an explicit staff commitment, not an inferred waiver.
  if (!Number.isFinite(required) || required <= 0) return { confirmed:false, reason:'commercial_approval_required' as const }
  const records = (quote.paymentRecords || []).filter(p => p.kind === 'deposit').reduce((sum,p) => sum + Math.max(0,Number(p.amount)||0),0)
  const paid = Math.max(records, Number(quote.depositPaidAmount)||0)
  if (Math.round(paid*100) < Math.round(required*100)) return { confirmed:false, reason:'deposit_required' as const }
  return { confirmed:true, reason:'accepted_and_deposit_satisfied' as const }
}
export function hasFullQuotePayment(lead: Pick<CRMLead,'paymentStatus'>, quote?: CRMQuote | null) {
  if (!quote) return lead.paymentStatus === 'paid_in_full'
  const total = Number(quote.total)
  if (!Number.isFinite(total) || total < 0) return false
  const paid = Math.max(Number(quote.depositPaidAmount||0)+Number(quote.balancePaidAmount||0),
    (quote.paymentRecords||[]).reduce((sum,p)=>sum+Math.max(0,Number(p.amount)||0),0))
  return total === 0 ? quote.status === 'accepted' || quote.status === 'invoiced' : Math.round(paid*100)>=Math.round(total*100)
}
