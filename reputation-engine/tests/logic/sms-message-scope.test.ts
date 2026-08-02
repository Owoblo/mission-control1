import test from 'node:test'
import assert from 'node:assert/strict'
import { smsMessageBelongsToPhone } from '../../lib/sms-message-scope'

test('accepts messages whose customer participant is the lead phone', () => {
  assert.equal(smsMessageBelongsToPhone({
    from_number: '+12262419853',
    to_number: '+1 (226) 929-7953',
  }, '2269297953'), true)
})

test('rejects a shared partnership-line message stamped with the wrong lead id', () => {
  assert.equal(smsMessageBelongsToPhone({
    from_number: '+12262419853',
    to_number: '+12267492135',
  }, '+12269297953'), false)
})
