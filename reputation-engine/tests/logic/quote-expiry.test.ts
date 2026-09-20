import test from 'node:test'
import assert from 'node:assert/strict'
import { isQuoteExpired, quoteExpiryDate } from '../../lib/quote-expiry'
import type { CRMQuote } from '../../lib/types'

const DAY = 24 * 60 * 60 * 1000

type ExpiryInput = Pick<CRMQuote, 'status' | 'createdAt' | 'validDays' | 'acceptedAt'>

function quote(overrides: Partial<ExpiryInput> = {}): ExpiryInput {
  return {
    status: 'sent',
    createdAt: new Date(Date.now() - 5 * DAY).toISOString(),
    validDays: 30,
    acceptedAt: undefined,
    ...overrides,
  }
}

test('a fresh quote is not expired', () => {
  assert.equal(isQuoteExpired(quote()), false)
})

test('a quote past its validity window is expired', () => {
  assert.equal(isQuoteExpired(quote({ createdAt: new Date(Date.now() - 31 * DAY).toISOString() })), true)
})

test('validDays overrides the default 30-day window', () => {
  assert.equal(isQuoteExpired(quote({ createdAt: new Date(Date.now() - 8 * DAY).toISOString(), validDays: 7 })), true)
  assert.equal(isQuoteExpired(quote({ createdAt: new Date(Date.now() - 8 * DAY).toISOString(), validDays: 14 })), false)
})

test('non-positive validDays falls back to 30', () => {
  assert.equal(isQuoteExpired(quote({ createdAt: new Date(Date.now() - 31 * DAY).toISOString(), validDays: 0 })), true)
  assert.equal(isQuoteExpired(quote({ createdAt: new Date(Date.now() - 5 * DAY).toISOString(), validDays: -3 })), false)
})

test('terminal states are never expired — they stay viewable as records', () => {
  for (const status of ['accepted', 'invoiced', 'declined'] as const) {
    assert.equal(
      isQuoteExpired(quote({ status, createdAt: new Date(Date.now() - 400 * DAY).toISOString() })),
      false,
      status,
    )
  }
})

test('a quote with acceptedAt is never expired even if the status lags', () => {
  assert.equal(
    isQuoteExpired(quote({ createdAt: new Date(Date.now() - 400 * DAY).toISOString(), acceptedAt: new Date().toISOString() })),
    false,
  )
})

test('missing or unparsable createdAt never expires', () => {
  assert.equal(isQuoteExpired(quote({ createdAt: '' })), false)
  assert.equal(isQuoteExpired(quote({ createdAt: 'not-a-date' })), false)
})

test('date-only createdAt is treated as midday to avoid timezone edge expiry', () => {
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * DAY).toISOString().slice(0, 10)
  assert.equal(isQuoteExpired(quote({ createdAt: thirtyOneDaysAgo })), true)
})

test('quoteExpiryDate returns the calendar expiry date', () => {
  const created = '2026-09-01T10:00:00.000Z'
  assert.equal(quoteExpiryDate({ createdAt: created, validDays: 30 }), '2026-10-01')
  assert.equal(quoteExpiryDate({ createdAt: created, validDays: 7 }), '2026-09-08')
})

test('quoteExpiryDate returns null without a usable createdAt', () => {
  assert.equal(quoteExpiryDate({ createdAt: '', validDays: 30 }), null)
})
