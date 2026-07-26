import assert from 'node:assert/strict'
import {
  listingInventoryFallbackAllowed,
  listingInventoryScanDedupeKey,
  listingInventoryScanInProgress,
} from '../../lib/listing-inventory-discovery'

assert.equal(
  listingInventoryScanDedupeKey('lead_1', 'listing_9'),
  'listing_inventory_scan:lead_1:listing_9',
)

assert.equal(listingInventoryScanInProgress({
  qualificationState: { inventoryDiscovery: { status: 'queued' } },
}), true)
assert.equal(listingInventoryScanInProgress({
  qualificationState: { inventoryDiscovery: { status: 'scanning' } },
}), true)
assert.equal(listingInventoryScanInProgress({
  qualificationState: { inventoryDiscovery: { status: 'completed' } },
}), false)

assert.equal(listingInventoryFallbackAllowed({
  qualificationState: { inventoryDiscovery: { status: 'queued' } },
}), false, 'fallback must not fire while a scan is queued')
assert.equal(listingInventoryFallbackAllowed({
  qualificationState: { inventoryDiscovery: { status: 'scanning' } },
}), false, 'fallback must not fire while a scan is running')
assert.equal(listingInventoryFallbackAllowed({
  qualificationState: { inventoryDiscovery: { status: 'unavailable' } },
}), true, 'fallback becomes available after a definitive unavailable result')
assert.equal(listingInventoryFallbackAllowed({
  qualificationState: { inventoryDiscovery: { status: 'failed' } },
}), true, 'fallback becomes available after a definitive failure')
assert.equal(listingInventoryFallbackAllowed({
  inventory: [{ name: 'Sofa', room: 'Living Room', qty: 1 }],
}), false, 'fallback must not replace inventory already found')
assert.equal(listingInventoryFallbackAllowed({
  surveyRequestedAt: '2026-07-24T12:00:00.000Z',
}), false, 'fallback must not send the survey twice')

console.log('listing inventory discovery lifecycle tests passed')
