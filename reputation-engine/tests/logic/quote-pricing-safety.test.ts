import assert from 'node:assert/strict'
import test from 'node:test'
import { hasDeliverableQuotePricing, quotePricingUpdateWouldEraseSnapshot } from '../../lib/quote-pricing-safety'
import type { CRMQuote } from '../../lib/types'

const quote = {
  id: 'qt_safe',
  number: 'QT-INTERNAL',
  clientId: 'client_1',
  status: 'viewed',
  lineItems: [{ description: 'Moving', amount: 1080 }],
  subtotal: 1080,
  hst: 140.4,
  total: 1220.4,
  deposit: 244.08,
  balance: 976.32,
  createdAt: '2026-07-28',
} as CRMQuote

test('deliverable quote pricing requires a positive total and priced line', () => {
  assert.equal(hasDeliverableQuotePricing(quote), true)
  assert.equal(hasDeliverableQuotePricing({ ...quote, total: 0 }), false)
  assert.equal(hasDeliverableQuotePricing({ ...quote, lineItems: [] }), false)
})

test('metadata updates remain allowed but empty pricing cannot erase a snapshot', () => {
  assert.equal(quotePricingUpdateWouldEraseSnapshot(quote, { internalNotes: 'Updated' }), false)
  assert.equal(quotePricingUpdateWouldEraseSnapshot(quote, { total: 0, lineItems: [] }), true)
})
