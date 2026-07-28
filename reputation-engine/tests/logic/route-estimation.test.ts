import assert from 'node:assert/strict'
import test from 'node:test'
import { inferAddressCountryContext, qualifyMoveAddress } from '../../lib/route-address'
import { findNearestRouteBranch, isDrivingRoutePlausible, normalizeDrivingRoute, resolveRouteBranchForEstimate } from '../../lib/server/route-estimation'

test('route estimate infers Waterloo/KW branch from Waterloo to Kitchener addresses', () => {
  const branch = resolveRouteBranchForEstimate({
    origin: '55 Erb Street East, Waterloo, ON, Canada',
    destination: '10 King Street West, Kitchener, ON, Canada',
  })

  assert.equal(branch, 'waterloo')
})

test('route estimate infers Waterloo/KW branch from Cambridge addresses when branch is omitted', () => {
  const branch = resolveRouteBranchForEstimate({
    origin: '70 Peachtree Crescent, Cambridge, ON, Canada',
    destination: '106 Highland Park, Cambridge, ON, Canada',
  })

  assert.equal(branch, 'waterloo')
})

test('route estimate infers Waterloo/KW branch for an Elora to Wilmot move', () => {
  const branch = resolveRouteBranchForEstimate({
    origin: '1 Cutting Drive, Elora, ON, Canada',
    destination: '1349 Queen Street, Wilmot, ON, Canada',
  })

  assert.equal(branch, 'waterloo')
})

test('map fallback chooses the nearest yard for an unfamiliar geocoded area', () => {
  assert.equal(findNearestRouteBranch({ lat: 43.6837, lng: -79.7663 }), 'waterloo')
  assert.equal(findNearestRouteBranch({ lat: 42.8865, lng: -81.0188 }), 'london')
  assert.equal(findNearestRouteBranch({ lat: 45.2692, lng: -75.7478 }), 'ottawa')
})

test('route estimate preserves non-zero short local routes', () => {
  const route = normalizeDrivingRoute(2100, 270)

  assert.equal(route.distanceKm, 2)
  assert.equal(route.driveHours, 0.25)
})

test('route estimate still allows true same-address routes to be zero', () => {
  const route = normalizeDrivingRoute(0, 0)

  assert.equal(route.distanceKm, 0)
  assert.equal(route.driveHours, 0)
})

test('cross-border Michigan destinations are not coerced into Ontario', () => {
  assert.equal(
    qualifyMoveAddress('43175 Londonderry Court, Canton, Michigan, USA', 'Michigan'),
    '43175 Londonderry Court, Canton, Michigan, USA'
  )
  assert.equal(inferAddressCountryContext('Canton Township, Michigan'), 'us')
})

test('unqualified local addresses retain the Ontario default', () => {
  assert.equal(
    qualifyMoveAddress('666 Chippawa Street', 'Windsor'),
    '666 Chippawa Street, Windsor, Ontario, Canada'
  )
})

test('route sanity guard rejects a wrong-country distance mismatch', () => {
  const windsor = { lat: 42.3149, lng: -83.0364 }
  const cantonMichigan = { lat: 42.3086, lng: -83.4822 }
  assert.equal(isDrivingRoutePlausible(windsor, cantonMichigan, 65), true)
  assert.equal(isDrivingRoutePlausible(windsor, cantonMichigan, 400), false)
})
