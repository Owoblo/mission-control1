import assert from 'node:assert/strict'
import test from 'node:test'
import { removeStorageQuoteScope } from '../../lib/storage-quote-scope'

test('storage opt-out clears every storage state without touching unrelated move scope', () => {
  const result = removeStorageQuoteScope({
    fallbackQuoteType: 'standard',
    factors: {
      destinationTiming: 'known_gap',
      temporaryStorageNeeded: true,
      storageDurationKnown: true,
      storageEstimatedMonths: 2,
      storageMonthlyAllowance: 250,
      planningScenario: 'storage_staged',
      preferredOperatingPlan: 'split_day_storage',
      packingStatus: 'packed',
    },
    legs: [
      { id: 'storage-out', label: 'Home to storage', type: 'storage' },
      { id: 'storage-in', label: 'Storage to home', type: 'storage_delivery' },
      { id: 'delivery', label: 'Second pickup', type: 'delivery' },
    ],
    lineItems: [
      { description: 'Storage Load/Unload Service', amount: 900 },
      { description: 'Moving Service', amount: 1200 },
      { description: 'Professional Packing Service', amount: 500 },
    ],
  })

  assert.equal(result.quoteType, 'standard')
  assert.equal(result.factors.temporaryStorageNeeded, false)
  assert.equal(result.factors.storageEstimatedMonths, undefined)
  assert.equal(result.factors.planningScenario, 'standard')
  assert.equal(result.factors.preferredOperatingPlan, undefined)
  assert.equal(result.factors.packingStatus, 'packed')
  assert.deepEqual(result.legs.map(leg => leg.type), ['delivery'])
  assert.deepEqual(result.lineItems.map(item => item.description), ['Moving Service', 'Professional Packing Service'])
  assert.equal(result.legsEnabled, true)
})

test('storage opt-out stays off when storage was never explicitly selected', () => {
  const result = removeStorageQuoteScope({
    fallbackQuoteType: 'long_distance',
    factors: { destinationTiming: 'unknown' },
    legs: [],
    lineItems: [{ description: 'Long-Distance Moving Service', amount: 4000 }],
  })

  assert.equal(result.factors.temporaryStorageNeeded, false)
  assert.equal(result.quoteType, 'long_distance')
  assert.equal(result.legsEnabled, false)
})
