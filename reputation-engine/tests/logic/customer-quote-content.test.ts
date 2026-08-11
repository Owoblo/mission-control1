import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeCustomerQuoteText } from '../../lib/customer-quote-content'

test('removes internal margin and manager-review language from public quote copy', () => {
  const input = 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed. Current margin is 40.9%; manager review may be required.'
  assert.equal(sanitizeCustomerQuoteText(input), 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed.')
})

test('preserves customer-actionable provisional language', () => {
  const input = 'Final pricing will be confirmed once we verify the inventory and packing status.'
  assert.equal(sanitizeCustomerQuoteText(input), input)
})
