import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPaymentConfirmationSms } from '../../lib/payment-confirmation'

test('final payment confirmation is calm and keeps accounting detail in the receipt', () => {
  const body = buildPaymentConfirmationSms({
    customerName: 'Geena Gohn',
    brandName: 'Saturn Star Moving',
    amount: 1491.6,
    balanceAfterPayment: 0,
    receiptUrl: 'https://go.quote2move.com/receipt?id=quote&token=token',
  })

  assert.match(body, /^Hi Geena, we've received your payment of \$1,491\.60\./)
  assert.match(body, /Your move is now paid in full\./)
  assert.match(body, /View your receipt:/)
  assert.match(body, /Thank you for choosing Saturn Star Moving\./)
  assert.doesNotMatch(body, /SSR-/)
  assert.doesNotMatch(body, /Balance: \$0\.00/)
})

test('partial payment confirmation states the useful remaining balance', () => {
  const body = buildPaymentConfirmationSms({
    customerName: 'Mario Rossi',
    brandName: 'Saturn Star Moving',
    amount: 500,
    balanceAfterPayment: 725.25,
  })

  assert.match(body, /Your remaining balance is \$725\.25\./)
  assert.doesNotMatch(body, /paid in full/)
})
