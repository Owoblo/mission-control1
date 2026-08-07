import assert from 'node:assert/strict'
import test from 'node:test'
import { matchReviewLocationForLead, matchReviewLocationFromText, nearestReviewLocationByCoordinates } from '../../lib/review-locations'

test('matches a review location from the origin city text', () => {
  assert.equal(matchReviewLocationFromText('1415 Campbell Avenue, Windsor, ON')?.id, 'windsor')
  assert.equal(matchReviewLocationFromText('Amherstburg, Ontario')?.id, 'windsor')
  assert.equal(matchReviewLocationFromText('Kanata, Ontario')?.id, 'ottawa')
})

test('chooses the closest profile from coordinates', () => {
  assert.equal(nearestReviewLocationByCoordinates(43.54, -80.25).location.id, 'guelph')
  assert.equal(nearestReviewLocationByCoordinates(43.47, -80.50).location.id, 'waterloo')
})

test('Kitchener resolves to the nearest configured Waterloo profile', () => {
  assert.equal(matchReviewLocationFromText('Kitchener, Ontario')?.id, 'waterloo')
})

test('uses lead service-area signals when a street address has no city', () => {
  assert.equal(matchReviewLocationForLead({ originAddress: '5 Beechwood Lane', branch: 'waterloo' })?.id, 'waterloo')
})

test('uses the destination service area for a cross-border origin', () => {
  assert.equal(matchReviewLocationForLead({ originCity: 'Canton Township, Michigan', destCity: 'Windsor, Ontario' })?.id, 'windsor')
})
