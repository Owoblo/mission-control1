import assert from 'node:assert/strict'
import test from 'node:test'
import { matchReviewLocationFromText, nearestReviewLocationByCoordinates } from '../../lib/review-locations'

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
