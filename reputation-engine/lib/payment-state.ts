import type { CRMLead, CRMQuote, PaymentRecord } from './types'

export type MoneyState = {
  status: 'not_attempted' | 'deposit_received' | 'partially_paid' | 'paid_in_full' | 'overpaid' | 'partially_refunded' | 'refunded' | 'reconciliation_required'
  label: string
  total: number
  captured: number
  refunded: number
  netPaid: number
  balance: number
  explanation: string
  requiresAttention: boolean
}

function capturedAmount(record: PaymentRecord) {
  return record.status === 'refunded' ? 0 : Math.max(0, Number(record.amount || 0) - Number(record.refundedAmount || 0))
}

export function deriveMoneyState(quote?: CRMQuote | null, lead?: CRMLead | null): MoneyState {
  const total = Math.max(0, Number(quote?.total || 0))
  const records = quote?.paymentRecords || []
  const recordedGross = records.reduce((sum, record) => sum + Math.max(0, Number(record.amount || 0)), 0)
  const refunded = records.reduce((sum, record) => sum + (record.status === 'refunded' ? Math.max(0, Number(record.amount || 0)) : Math.max(0, Number(record.refundedAmount || 0))), 0)
  const capturedFromRecords = records.reduce((sum, record) => sum + capturedAmount(record), 0)
  const legacyCaptured = Math.max(0, Number(quote?.depositPaidAmount || 0) + Number(quote?.balancePaidAmount || 0), lead?.paymentStatus && lead.paymentStatus !== 'pending' ? Number(lead.depositAmount || 0) : 0)
  const captured = records.length ? capturedFromRecords : legacyCaptured
  const netPaid = Math.max(0, captured)
  const balance = Math.max(0, Math.round((total - netPaid) * 100) / 100)
  const expectedLeadStatus = balance <= 0 && total > 0 ? 'paid_in_full' : netPaid > 0 ? 'deposit_received' : 'pending'
  const staleLeadStatus = Boolean(lead?.paymentStatus && lead.paymentStatus !== expectedLeadStatus)

  if (staleLeadStatus) return { status: 'reconciliation_required', label: 'Reconciliation required', total, captured, refunded, netPaid, balance, explanation: `Recorded transactions indicate ${expectedLeadStatus.replaceAll('_', ' ')}, but the lead is marked ${lead?.paymentStatus?.replaceAll('_', ' ')}.`, requiresAttention: true }
  if (refunded > 0 && netPaid <= 0) return { status: 'refunded', label: 'Refunded', total, captured: recordedGross, refunded, netPaid, balance, explanation: 'All recorded payment value has been refunded.', requiresAttention: false }
  if (refunded > 0) return { status: 'partially_refunded', label: 'Partially refunded', total, captured: recordedGross, refunded, netPaid, balance, explanation: `${refunded.toFixed(2)} has been refunded; ${netPaid.toFixed(2)} remains paid.`, requiresAttention: true }
  if (total > 0 && netPaid > total) return { status: 'overpaid', label: 'Overpaid', total, captured, refunded, netPaid, balance: 0, explanation: `Payment exceeds the quote by ${(netPaid - total).toFixed(2)}.`, requiresAttention: true }
  if (total > 0 && balance <= 0) return { status: 'paid_in_full', label: 'Paid in full', total, captured, refunded, netPaid, balance, explanation: 'Recorded payments cover the quoted total.', requiresAttention: false }
  if (netPaid > 0 && quote?.deposit && netPaid >= Number(quote.deposit)) return { status: 'deposit_received', label: 'Deposit received', total, captured, refunded, netPaid, balance, explanation: 'The required deposit is recorded; a balance remains.', requiresAttention: false }
  if (netPaid > 0) return { status: 'partially_paid', label: 'Partially paid', total, captured, refunded, netPaid, balance, explanation: 'A payment is recorded but it does not yet satisfy the required deposit or total.', requiresAttention: true }
  return { status: 'not_attempted', label: 'Payment not recorded', total, captured: 0, refunded: 0, netPaid: 0, balance: total, explanation: 'No captured payment is recorded.', requiresAttention: false }
}
