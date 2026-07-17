import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPaymentRecord } from '../../lib/payment-records'
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
