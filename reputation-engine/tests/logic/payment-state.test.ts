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


test('an earlier e-transfer flag is recorded value requiring confirmation, not a Stripe receipt', () => {
  const result = deriveMoneyState({ id: 'q', total: 1469, deposit: 440.7, paymentRecords: [] } as any, { paymentStatus: 'deposit_received', depositAmount: 500, depositMethod: 'etransfer' } as any)
  assert.equal(result.netPaid, 500)
  assert.equal(result.balance, 969)
  assert.equal(result.status, 'reconciliation_required')
  assert.match(result.explanation, /etransfer/)
})
test('a new balance receipt retains an earlier deposit without counting it twice', () => {
  const result = deriveMoneyState({ total: 1469, balancePaidAmount: 969, paymentRecords: [{ kind: 'final', amount: 969 }] } as any, { paymentStatus: 'paid_in_full', depositAmount: 500, depositMethod: 'etransfer' } as any)
  assert.equal(result.netPaid, 1469)
  assert.equal(result.balance, 0)
})
test('legacy paid flags cannot resurrect a refunded deposit receipt', () => {
  const result = deriveMoneyState({ total: 1000, depositPaidAmount: 200, paymentRecords: [{ kind: 'deposit', amount: 200, status: 'refunded' }] } as any, { paymentStatus: 'pending', depositAmount: 200 } as any)
  assert.equal(result.netPaid, 0)
  assert.equal(result.refunded, 200)
})
