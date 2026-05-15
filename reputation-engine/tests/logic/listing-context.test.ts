import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatListingContextSummary,
  formatListingPropertySummary,
  getListingDescription,
  getListingOperationalHighlights,
  shouldPreferListingSnapshot,
} from '../../lib/listing'
import type { ListingMatch } from '../../lib/types'

test('listing helpers expose richer property context when available', () => {
  const listing: ListingMatch = {
    zpid: '460694309',
    address: '928 Evens Pond Ct, Kitchener, ON N2R 0B8',
    city: 'Kitchener',
    beds: 6,
    baths: 5,
    description: 'END OF COURT. INGROUND POOL. OVERSIZED LOT. BACKING ONTO GREENSPACE WITH A WALKOUT BASEMENT.',
    parkingFeatures: ['Attached Garage', 'Private Drive Triple+ Wide'],
    basement: 'Separate Entrance,Walk-Out Access,Full,Finished',
    livingArea: 3106,
    yearBuilt: 2011,
    streetViewMetadataUrl: 'https://maps.googleapis.com/maps/api/streetview/metadata?...',
    carouselphotos: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
  }

  assert.equal(formatListingPropertySummary(listing), '6 beds · 5 baths')
  assert.match(getListingDescription(listing) || '', /walkout basement/i)

  const highlights = getListingOperationalHighlights(listing)
  assert.ok(highlights.some(item => /attached garage/i.test(item)))
  assert.ok(highlights.some(item => /walk-out access/i.test(item)))
  assert.ok(highlights.some(item => /3,106 sq ft/i.test(item)))
  assert.ok(highlights.some(item => /street view metadata available/i.test(item)))
})

test('richer listing snapshots replace thin snapshots', () => {
  const thin: ListingMatch = {
    zpid: '460694309',
    address: '928 Evens Pond Ct, Kitchener, ON N2R 0B8',
    city: 'Kitchener',
    carouselphotos: ['https://example.com/1.jpg'],
  }
  const rich: ListingMatch = {
    ...thin,
    beds: 6,
    baths: 5,
    description: 'Walkout basement and triple-wide drive.',
    parkingFeatures: ['Attached Garage'],
    streetViewMetadataUrl: 'https://maps.googleapis.com/maps/api/streetview/metadata?...',
    carouselphotos: ['https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
  }

  assert.equal(shouldPreferListingSnapshot(thin, rich), true)
  assert.equal(shouldPreferListingSnapshot(rich, thin), false)
})

test('matched listings still surface a context summary when structured bed and bath fields are missing', () => {
  const thinMatched: ListingMatch = {
    zpid: '12345',
    address: '631 Doon South Drive, Kitchener, ON, Canada',
    city: 'Kitchener',
    carouselphotos: ['https://example.com/1.jpg'],
  }

  assert.equal(formatListingContextSummary(thinMatched), 'Listing matched')
})
