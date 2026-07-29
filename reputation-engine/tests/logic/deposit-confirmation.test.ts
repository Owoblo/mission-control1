import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDepositConfirmationSms } from '../../lib/deposit-confirmation'

test('deposit confirmation is warm, specific, and customer-facing', () => {
  const body = buildDepositConfirmationSms({
    customerName: 'Scott Vanderweyst',
    brandName: 'Saturn Star Moving',
    amount: 269.62,
    receiptUrl: 'https://go.quote2move.com/receipt?id=q1&token=t1',
  })

  assert.match(body, /Hi Scott/)
  assert.match(body, /\$269\.62 deposit/)
  assert.match(body, /move is confirmed/)
  assert.match(body, /receipt:/i)
  assert.doesNotMatch(body, /\bQT-\d/i)
  assert.doesNotMatch(body, /amazing|can't wait|super excited/i)
})
