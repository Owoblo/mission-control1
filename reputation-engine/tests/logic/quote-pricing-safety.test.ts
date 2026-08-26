import assert from 'node:assert/strict'
import test from 'node:test'
import { getQuoteCommercialArithmeticError, hasCustomerFacingCommercialSnapshot, hasDeliverableQuotePricing, quoteCommercialSnapshotChanged, quoteDeliveryBlockReason, quotePricingUpdateWouldEraseSnapshot, splitOntarioHstInclusiveTotal } from '../../lib/quote-pricing-safety'
import type { CRMQuote } from '../../lib/types'

const quote = {
  id: 'qt_safe',
  number: 'QT-INTERNAL',
  clientId: 'client_1',
  status: 'viewed',
  lineItems: [{ description: 'Moving', amount: 1080 }],
  subtotal: 1080,
  hst: 140.4,
  total: 1220.4,
  deposit: 244.08,
  balance: 976.32,
  createdAt: '2026-07-28',
} as CRMQuote

test('deliverable quote pricing requires a positive total and priced line', () => {
  assert.equal(hasDeliverableQuotePricing(quote), true)
  assert.equal(hasDeliverableQuotePricing({ ...quote, total: 0 }), false)
  assert.equal(hasDeliverableQuotePricing({ ...quote, lineItems: [] }), false)
})

test('metadata updates remain allowed but empty pricing cannot erase a snapshot', () => {
  assert.equal(quotePricingUpdateWouldEraseSnapshot(quote, { internalNotes: 'Updated' }), false)
  assert.equal(quotePricingUpdateWouldEraseSnapshot(quote, { total: 0, lineItems: [] }), true)
})

test('Allison regression: schedule changes cannot silently replace the agreed commercial snapshot', () => {
  const agreed = {
    ...quote,
    status: 'sent' as const,
    sentAt: '2026-08-21T17:57:39.196Z',
    lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 1200 }],
    subtotal: 1200,
    hst: 156,
    total: 1356,
    deposit: 406.8,
    balance: 949.2,
  }
  assert.equal(hasCustomerFacingCommercialSnapshot(agreed), true)
  assert.equal(quoteCommercialSnapshotChanged(agreed, { moveDate: '2026-09-03', moveTime: '16:00' }), false)
  assert.equal(quoteCommercialSnapshotChanged(agreed, {
    lineItems: [{ description: 'Full-Service Moving', amount: 1575 }],
    subtotal: 1575,
    hst: 204.75,
    total: 1779.75,
    deposit: 533.92,
    balance: 1245.83,
  }), true)
})

test('declined quotes cannot be delivered again without an explicit revision workflow', () => {
  assert.match(quoteDeliveryBlockReason({ status: 'declined', respondedAt: '2026-08-24T16:41:53.540Z' }) || '', /declined/i)
  assert.match(quoteDeliveryBlockReason({ status: 'sent', respondedAt: '2026-08-24T16:41:53.540Z' }) || '', /customer response/i)
  assert.equal(quoteDeliveryBlockReason({ status: 'sent', respondedAt: undefined }), null)
})

test('an agreed all-in override is split into subtotal and HST exactly once', () => {
  assert.deepEqual(splitOntarioHstInclusiveTotal(1600), {
    subtotal: 1415.93,
    hst: 184.07,
    total: 1600,
  })
})

test('commercial arithmetic rejects double HST and inconsistent line totals', () => {
  assert.equal(getQuoteCommercialArithmeticError({
    lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 1415.93 }],
    discountAmount: 0,
    subtotal: 1415.93,
    hst: 184.07,
    total: 1600,
  }), null)

  assert.match(getQuoteCommercialArithmeticError({
    lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 1600 }],
    discountAmount: 0,
    subtotal: 1600,
    hst: 208,
    total: 1808,
    priceOverrideTotal: 1600,
  }) || '', /agreed customer override total/i)

  assert.match(getQuoteCommercialArithmeticError({
    lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 1415.93 }],
    discountAmount: 0,
    subtotal: 1600,
    hst: 208,
    total: 1808,
  }) || '', /subtotal/i)
})
