import assert from 'node:assert/strict'
import test from 'node:test'
import { isProvisionalQuoteScope } from '../../lib/quote-scope-status'

test('recognizes durable and legacy provisional quote markers', () => {
  assert.equal(isProvisionalQuoteScope({ scopeStatus: 'provisional' }), true)
  assert.equal(isProvisionalQuoteScope({ moveDescription: 'Provisional estimate. Final pricing will be confirmed once we verify access.' }), true)
  assert.equal(isProvisionalQuoteScope({ internalNotes: 'PROVISIONAL QUOTE — collect before final confirmation' }), true)
  assert.equal(isProvisionalQuoteScope({ scopeStatus: 'confirmed', moveDescription: 'Confirmed move plan' }), false)
})
