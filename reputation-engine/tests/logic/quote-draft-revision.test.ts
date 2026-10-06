import assert from 'node:assert/strict'
import test from 'node:test'
import { rebaseQuoteDraftUpdate } from '../../lib/quote-draft-revision'
import { quoteEditConflict } from '../../lib/quote-pricing-safety'
import type { CRMQuote } from '../../lib/types'

const base = { id: 'quote', revision: 4, status: 'sent', total: 1130, subtotal: 1000, hst: 130, lineItems: [{ description: 'Agreed rate', amount: 1000 }], destAddress: 'Old address' } as CRMQuote
const draft = { revision: 4, total: 799.99, subtotal: 707.96, hst: 92.03, lineItems: [{ description: 'Agreed rate', amount: 707.96 }], destAddress: 'Old address', pricingRevisionReason: 'Customer removed items' }

test('customer view no longer blocks the preserved revised price', () => {
  const latest = { ...base, revision: 5, status: 'viewed' as const, viewedAt: '2026-10-06T16:26:06Z' }
  assert.match(quoteEditConflict(latest, draft) || '', /another session/)
  const update = rebaseQuoteDraftUpdate(base, latest, draft)
  assert.equal(update.revision, 5)
  assert.equal(update.total, 799.99)
  assert.equal(update.pricingRevisionReason, draft.pricingRevisionReason)
  assert.equal(quoteEditConflict(latest, update), undefined)
  assert.equal(Object.hasOwn(update, 'status'), false)
})

test('lead address synchronization preserves new address while saving edited price', () => {
  const latest = { ...base, revision: 7, destAddress: 'Corrected address' }
  const update = rebaseQuoteDraftUpdate(base, latest, draft)
  assert.equal(Object.hasOwn(update, 'destAddress'), false)
  assert.equal(update.total, 799.99)
  assert.equal(update.revision, 7)
  assert.equal(draft.destAddress, 'Old address')
})

test('a simultaneous conflicting address edit is not overwritten', () => {
  assert.throws(() => rebaseQuoteDraftUpdate(base, { ...base, revision: 5, destAddress: 'Other edit' }, { ...draft, destAddress: 'Rep edit' }), /changed while this draft/)
})

test('concurrent financial, approval and acceptance updates still require review', () => {
  for (const change of [{ total: 1200 }, { priceOverrideApprovalStatus: 'approved' }, { status: 'accepted' }, { status: 'declined' }, { depositPaidAt: '2026-10-06' }, { internalNotes: 'Other rep instruction' }]) {
    assert.throws(() => rebaseQuoteDraftUpdate(base, { ...base, revision: 5, ...change } as CRMQuote, draft), /changed while this draft/)
  }
})

test('send and token updates can advance the draft without changing its price', () => {
  const original = { ...base, status: 'draft' as const }
  const update = rebaseQuoteDraftUpdate(original, { ...base, revision: 6, sentAt: '2026-10-06', acceptToken: 'server-generated' }, draft)
  assert.equal(update.total, 799.99)
  assert.equal(update.revision, 6)
  assert.equal(Object.hasOwn(update, 'acceptToken'), false)
})

test('subsequent concurrent write is still rejected by server revision guard', () => {
  const update = rebaseQuoteDraftUpdate(base, { ...base, revision: 5, viewedAt: '2026-10-06' }, draft)
  assert.match(quoteEditConflict({ ...base, revision: 6 }, update) || '', /another session/)
})
