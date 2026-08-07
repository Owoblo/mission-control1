import assert from 'node:assert/strict'
import test from 'node:test'
import { isPastReviewCustomer, normalizedReviewContact } from '../../lib/review-customer-sync'

const today = new Date('2026-08-06T12:00:00Z')

test('includes completed and customer-success records regardless of missing move date', () => {
  assert.equal(isPastReviewCustomer({ stage: 'completed' }, today), true)
  assert.equal(isPastReviewCustomer({ stage: 'customer_success' }, today), true)
})

test('includes booked moves only after their move date', () => {
  assert.equal(isPastReviewCustomer({ stage: 'booked', moveDate: '2026-08-05' }, today), true)
  assert.equal(isPastReviewCustomer({ stage: 'booked', moveDate: '2026-08-07' }, today), false)
})

test('normalizes legacy phone formatting for deduplication', () => {
  assert.equal(normalizedReviewContact('(226) 773-2993'), normalizedReviewContact('226-773-2993'))
})
