import { uid } from './sales'
import { getQuotePaidSoFar } from './server/job-billing'
import type { CRMLead, CRMQuote, PaymentRecord, PaymentRecordKind, PaymentRecordMethod } from './types'

export const PAYMENT_METHOD_LABELS: Record<PaymentRecordMethod, string> = {
  credit_card: 'Credit Card', debit: 'Debit', etransfer: 'Interac E-Transfer', cash: 'Cash',
  cheque: 'Cheque', bank_transfer: 'Bank Transfer', other: 'Other',
}

export function resolveDepositReceiptAmount(quote: CRMQuote, lead?: CRMLead | null) {
  const latestDepositRecord = [...(quote.paymentRecords || [])]
    .filter(payment => payment.kind === 'deposit')
    .sort((left, right) => right.paidAt.localeCompare(left.paidAt))[0]

  return latestDepositRecord?.amount
    || Number(quote.depositPaidAmount || 0)
    || Number(lead?.depositAmount || 0)
}

export function buildPaymentRecord(input: {
  quote: CRMQuote
  lead?: CRMLead | null
  amount: number
  kind: PaymentRecordKind
  method: PaymentRecordMethod
  paidAt?: string
  note?: string
  reference?: string
  cardLast4?: string
  recordedBy?: string
  recordedByUserId?: string
}): PaymentRecord {
  const paid = getQuotePaidSoFar(input.quote, input.lead)
  const amount = Math.round(input.amount * 100) / 100
  const paidAfterPayment = Math.round((paid.totalPaid + amount) * 100) / 100
  const count = input.quote.paymentRecords?.length || 0
  return {
    id: uid('pay'),
    receiptNumber: `SSR-${new Date().getFullYear()}-${input.quote.number.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}-${String(count + 1).padStart(2, '0')}`,
    publicToken: crypto.randomUUID(), kind: input.kind, method: input.method, methodLabel: PAYMENT_METHOD_LABELS[input.method],
    amount, totalBeforePayment: input.quote.total, paidBeforePayment: paid.totalPaid, paidAfterPayment,
    balanceAfterPayment: Math.max(0, Math.round((input.quote.total - paidAfterPayment) * 100) / 100),
    paidAt: input.paidAt || new Date().toISOString(), note: input.note, reference: input.reference,
    cardLast4: input.cardLast4, recordedBy: input.recordedBy, recordedByUserId: input.recordedByUserId,
  }
}
