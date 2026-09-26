import assert from 'node:assert/strict'
import test from 'node:test'
import { marginReviewKey } from '../../lib/estimate-margin-review'
const base = { quoteId: 'fixture', subtotal: 4777.21, totalCost: 2498.20, minimumPrice: 3800, pendingInventory: '', lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 4777.21 }] }
test('acknowledgement survives recomputed objects and immaterial floating point changes', () => {
  assert.equal(marginReviewKey(base), marginReviewKey(structuredClone(base)))
  assert.equal(marginReviewKey(base), marginReviewKey({ ...base, totalCost: 2498.20000001 }))
})
test('price, costs, service scope, quote identity and pending inventory require a fresh review', () => {
  for (const change of [{ subtotal: 4700 }, { totalCost: 2600 }, { minimumPrice: 3900 }, { quoteId: 'other' }, { pendingInventory: 'Second pickup' }, { lineItems: [{ description: 'Packing', amount: 4777.21 }] }]) {
    assert.notEqual(marginReviewKey(base), marginReviewKey({ ...base, ...change }))
  }
})
