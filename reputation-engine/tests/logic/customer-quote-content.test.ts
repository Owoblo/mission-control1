import test from 'node:test'
import assert from 'node:assert/strict'
import { getCustomerQuoteOptionLabel, sanitizeCustomerQuoteText } from '../../lib/customer-quote-content'

test('removes internal margin and manager-review language from public quote copy', () => {
  const input = 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed. Current margin is 40.9%; manager review may be required.'
  assert.equal(sanitizeCustomerQuoteText(input), 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed.')
})

test('preserves customer-actionable provisional language', () => {
  const input = 'Final pricing will be confirmed once we verify the inventory and packing status.'
  assert.equal(sanitizeCustomerQuoteText(input), input)
})

test('does not promote provisional verification findings into the quote hero', () => {
  const moveDescription = 'Provisional estimate. Final pricing will be confirmed once we verify: No MLS, photo, video, customer-confirmed, or rep inventory evidence is on file.'
  assert.equal(getCustomerQuoteOptionLabel({ moveDescription }), undefined)
})

test('shows only explicit, concise quote-option labels', () => {
  assert.equal(
    getCustomerQuoteOptionLabel({ moveDescription: 'Quote option: One truck · two trips' }),
    'One truck · two trips',
  )
  assert.equal(getCustomerQuoteOptionLabel({ jobLabel: 'Preferred move plan' }), 'Preferred move plan')
  assert.equal(getCustomerQuoteOptionLabel({ jobLabel: 'x'.repeat(121) }), undefined)
})
