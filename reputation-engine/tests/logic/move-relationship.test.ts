import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeAttributionSignals,
  normalizeMoveRelationships,
  opportunityHealthLabel,
} from '../../lib/move-relationship'

test('opportunity health requires an owned, dated next step', () => {
  assert.equal(opportunityHealthLabel(), 'Needs context')
  assert.equal(opportunityHealthLabel({
    position: 'reviewing_estimate',
    bookingConfidence: 70,
    updatedAt: '2026-07-28T00:00:00.000Z',
  }), 'Needs next step')
})

test('multi-touch attribution deduplicates exact evidence without collapsing distinct influence', () => {
  const signals = normalizeAttributionSignals([
    { id: '1', channel: 'Direct mail', influence: 'first_touch', confidence: 'confirmed', observedAt: '2026-07-28' },
    { id: '2', channel: ' direct mail ', influence: 'first_touch', confidence: 'likely', observedAt: '2026-07-28' },
    { id: '3', channel: 'Direct mail', influence: 'assisted', confidence: 'confirmed', observedAt: '2026-07-28' },
  ])
  assert.equal(signals.length, 2)
})

test('a contact can hold multiple roles but duplicate role links are removed', () => {
  const base = { name: 'Jane Smith', confidence: 'confirmed' as const, createdAt: '2026-07-28' }
  const relationships = normalizeMoveRelationships([
    { ...base, id: '1', contactId: 'contact-1', role: 'listing_realtor' },
    { ...base, id: '2', contactId: 'contact-1', role: 'listing_realtor' },
    { ...base, id: '3', contactId: 'contact-1', role: 'referring_realtor' },
  ])
  assert.equal(relationships.length, 2)
})
