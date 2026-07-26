import assert from 'node:assert/strict'
import test from 'node:test'
import {
  customerReplyRequiresHuman,
  detectBookedCustomerSupportIntent,
  sameNormalizedSmsBody,
} from '../../lib/booked-customer-support'

test('recognizes an overdue box-delivery request', () => {
  assert.equal(
    detectBookedCustomerSupportIntent(
      "Hello, the boxes were not delivered yet. I'd like to have them as soon as possible."
    ),
    'box_delivery'
  )
})

test('booked and rep-owned customer replies require a human', () => {
  assert.equal(customerReplyRequiresHuman({ isBookedCustomer: true }), true)
  assert.equal(
    customerReplyRequiresHuman({
      isBookedCustomer: false,
      repWorkflowReason: 'A representative already contacted this lead.',
    }),
    true
  )
  assert.equal(customerReplyRequiresHuman({ isBookedCustomer: false }), false)
})

test('semantic duplicate comparison ignores casing and whitespace', () => {
  assert.equal(
    sameNormalizedSmsBody(
      'Thanks Eva.  We sent this to operations.',
      ' thanks eva. we sent this to operations. '
    ),
    true
  )
  assert.equal(
    sameNormalizedSmsBody(
      'We sent your box request to operations.',
      'We sent your schedule question to operations.'
    ),
    false
  )
})
