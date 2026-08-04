import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPaymentRecord, resolveDepositReceiptAmount } from '../../lib/payment-records'
import type { CRMQuote } from '../../lib/types'

function quote(overrides: Partial<CRMQuote> = {}): CRMQuote {
  return { id: 'q1', number: 'Q-1042', clientId: 'c1', status: 'accepted', lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 200, balance: 930, createdAt: '2026-07-17T00:00:00.000Z', ...overrides }
}

test('payment records preserve paid-to-date and remaining balance', () => {
  const first = buildPaymentRecord({ quote: quote(), amount: 200, kind: 'deposit', method: 'etransfer' })
  assert.equal(first.paidBeforePayment, 0)
  assert.equal(first.paidAfterPayment, 200)
  assert.equal(first.balanceAfterPayment, 930)

  const second = buildPaymentRecord({ quote: quote({ paymentRecords: [first] }), amount: 500, kind: 'partial', method: 'cash' })
  assert.equal(second.paidBeforePayment, 200)
  assert.equal(second.paidAfterPayment, 700)
  assert.equal(second.balanceAfterPayment, 430)
})

test('receipt uses the actual recorded payment instead of a stale quoted deposit', () => {
  const stale = quote({ deposit: 500, depositPaidAmount: 500 })
  const actual = buildPaymentRecord({ quote: stale, amount: 275, kind: 'deposit', method: 'etransfer' })
  const withActualPayment = quote({
    deposit: 500,
    depositPaidAmount: 500,
    paymentRecords: [{ ...actual, paidAt: '2026-07-17T12:00:00.000Z' }],
  })

  assert.equal(resolveDepositReceiptAmount(withActualPayment), 275)
})

test('receipt never falls back to a stale lead or quoted deposit amount', () => {
  const unverified = quote({ deposit: 100, depositPaidAmount: 500 })

  assert.equal(resolveDepositReceiptAmount(unverified), 0)
})
