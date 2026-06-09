import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDrivingRoute, resolveRouteBranchForEstimate } from '../../lib/server/route-estimation'

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
