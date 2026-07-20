import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveMoneyState } from '../../lib/payment-state'

const lead: any = { id: 'lead-1', paymentStatus: 'deposit_received' }
const quote: any = { id: 'quote-1', total: 1000, deposit: 200, paymentRecords: [{ id: 'p1', amount: 200, status: 'captured' }] }

test('money state derives deposit truth from transaction records', () => {
  assert.equal(deriveMoneyState(quote, lead).status, 'deposit_received')
})

test('money state exposes stale lead flags as reconciliation work', () => {
  const result = deriveMoneyState(quote, { ...lead, paymentStatus: 'paid_in_full' } as never)
  assert.equal(result.status, 'reconciliation_required')
  assert.equal(result.requiresAttention, true)
})

test('money state distinguishes partial refunds', () => {
  const result = deriveMoneyState({ ...quote, paymentRecords: [{ id: 'p1', amount: 200, status: 'partially_refunded', refundedAmount: 50 }] } as never, { ...lead, paymentStatus: 'deposit_received' } as never)
  assert.equal(result.status, 'partially_refunded')
  assert.equal(result.netPaid, 150)
})
