import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideListingMatch,
  extractListingReference,
  extractListingUnit,
  scoreListingCandidate,
  stripListingUnit,
} from '../../lib/listing-match'
import type { ListingMatch } from '../../lib/types'

function listing(zpid: string, address: string, photos = 0): ListingMatch {
  return { zpid, address, carouselphotos: Array.from({ length: photos }, (_, index) => `https://images.test/${index}.jpg`) }
}

test('normalizes common Canadian apartment formats to one building and unit', () => {
  assert.equal(extractListingUnit('601-203 Catherine Street, Ottawa, ON'), '601')
  assert.equal(extractListingUnit('203 Catherine St #601, Ottawa, ON'), '601')
  assert.equal(extractListingUnit('203 Catherine St Unit 601, Ottawa, ON'), '601')
  assert.equal(stripListingUnit('601-203 Catherine Street, Ottawa, ON'), '203 catherine st')
  assert.equal(stripListingUnit('203 Catherine St #601, Ottawa, ON'), '203 catherine st')
})

test('exact unit wins even when a different unit has many more photos', () => {
  const exact = listing('1', '203 Catherine St #601, Ottawa, ON', 0)
  const wrong = listing('2', '203 Catherine St #1204, Ottawa, ON', 49)
  const decision = decideListingMatch('601-203 Catherine Street, Ottawa, ON', [wrong, exact])
  assert.equal(decision.status, 'exact_unit')
  assert.equal(decision.listing?.zpid, '1')
  assert.ok(scoreListingCandidate('601-203 Catherine St', exact) > scoreListingCandidate('601-203 Catherine St', wrong))
})

test('missing requested unit never substitutes a neighboring unit', () => {
  const decision = decideListingMatch('601-203 Catherine St, Ottawa, ON', [
    listing('1', '203 Catherine St #1204, Ottawa, ON', 39),
    listing('2', '203 Catherine St #1203, Ottawa, ON', 36),
  ])
  assert.equal(decision.status, 'unit_not_found')
  assert.equal(decision.listing, null)
  assert.equal(decision.requiresSelection, true)
  assert.equal(decision.candidates.length, 2)
})

test('building-only searches require confirmation when unit records are returned', () => {
  const decision = decideListingMatch('203 Catherine St, Ottawa, ON', [
    listing('1', '203 Catherine St #1204, Ottawa, ON', 39),
    listing('2', '203 Catherine St #1203, Ottawa, ON', 36),
  ])
  assert.equal(decision.status, 'ambiguous_building')
  assert.equal(decision.listing, null)
})

test('standalone exact address remains eligible for automatic matching', () => {
  const home = listing('1', '10 Main Street, Windsor, ON', 20)
  const decision = decideListingMatch('10 Main St, Windsor, ON', [home])
  assert.equal(decision.status, 'exact_address')
  assert.equal(decision.listing?.zpid, '1')
})

test('extracts stored Zillow and MLS references without fetching external pages', () => {
  assert.equal(extractListingReference('https://www.zillow.com/homedetails/example/464097077_zpid/').zpid, '464097077')
  assert.equal(extractListingReference('https://example.test/property?mls=X13600614').mlsId, 'X13600614')
  assert.equal(extractListingReference('MLS #X13600614').mlsId, 'X13600614')
  assert.equal(extractListingReference('X13600614').mlsId, 'X13600614')
  assert.match(extractListingReference('https://www.realtor.com/realestateandhomes-detail/203-Catherine-St-Ottawa_ON_M1-12345').address || '', /203 Catherine St Ottawa/)
})
