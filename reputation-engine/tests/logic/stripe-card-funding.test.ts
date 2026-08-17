import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStripeCardPaymentLabel, normalizeStripeCardFunding, requiresCardFundingReview } from '../../lib/server/stripe-payments'

test('formats Stripe card network and funding without treating every card as credit', () => {
  assert.equal(formatStripeCardPaymentLabel('visa', 'debit'), 'Visa Debit')
  assert.equal(formatStripeCardPaymentLabel('mastercard', 'credit'), 'Mastercard Credit')
  assert.equal(formatStripeCardPaymentLabel('visa', 'prepaid'), 'Visa Prepaid')
})

test('flags debit and prepaid funding for internal review while accepting credit', () => {
  assert.equal(requiresCardFundingReview('debit'), true)
  assert.equal(requiresCardFundingReview('prepaid'), true)
  assert.equal(requiresCardFundingReview('credit'), false)
  assert.equal(normalizeStripeCardFunding('unexpected'), 'unknown')
})
