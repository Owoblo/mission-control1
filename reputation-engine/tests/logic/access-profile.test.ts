import test from 'node:test'
import assert from 'node:assert/strict'
import { accessProfilesForStops, calculateMoveAccessPlan, calculateStopAccess, createStandardAccessProfile, legacyAccessProfiles } from '../../lib/access-profile'
import type { AccessProfile } from '../../lib/types'

function profile(overrides: Partial<AccessProfile>): AccessProfile {
  return {
    id: 'access-origin', stopId: 'primary-origin', stopRole: 'pickup', label: 'Origin',
    truckPosition: 'loading_dock', walkToEntrance: 'under_1', entranceToVerticalAccess: 'under_1', verticalAccessToUnit: 'under_1',
    verticalMode: 'elevator', elevatorType: 'freight', elevatorReservation: 'confirmed', elevatorWait: 'short',
    evidenceStatus: 'customer_confirmed',
    ...overrides,
  }
}

test('standard access adds no time and is fully evidenced', () => {
  const standard = createStandardAccessProfile({ id: 'origin', stopId: 'primary-origin', stopRole: 'pickup', label: 'Origin', addressSnapshot: '1 Main St' })
  const result = calculateStopAccess(standard, 3)
  assert.equal(result.additionalAccessHours, 0)
  assert.equal(result.ready, true)
})

test('access example calculates each side independently without compounding factors', () => {
  const origin = profile({})
  const destination = profile({
    id: 'access-destination', stopId: 'primary-destination', stopRole: 'dropoff', label: 'Destination',
    walkToEntrance: '6_8', elevatorType: 'passenger', elevatorReservation: 'shared', elevatorWait: 'normal', loadingDockProcedureMinutes: 15,
  })
  const plan = calculateMoveAccessPlan([origin, destination], { origin: 3, destination: 2.5 })
  assert.equal(plan.stops[0].additionalAccessHours, 0.6)
  assert.equal(plan.stops[1].additionalAccessHours, 2.25)
  assert.equal(plan.additionalAccessHours, 2.85)
})

test('extreme carrying routes and stairs force manual review', () => {
  const result = calculateStopAccess(profile({ walkToEntrance: 'over_8', verticalMode: 'stairs', stairFlights: 5 }), 3)
  assert.match(result.manualReviewReasons.join(' '), /exceeds eight minutes/)
  assert.match(result.manualReviewReasons.join(' '), /five or more stair flights/)
})

test('legacy origin and destination fields adapt without mutating old leads', () => {
  const profiles = legacyAccessProfiles({
    originAddress: '1 Main St', destAddress: '2 King St',
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 6, destHasElevator: true, destElevatorReserved: false, destParkingOk: true },
  })
  assert.equal(profiles.length, 2)
  assert.equal(profiles[0].standardAccessConfirmed, true)
  assert.equal(profiles[1].verticalMode, 'elevator')
  assert.equal(profiles[1].elevatorReservation, 'unknown')
})

test('additional pickup and storage addresses receive independent profiles', () => {
  const profiles = accessProfilesForStops({
    lead: { originAddress: '1 Main St', destAddress: '9 Final Ave', jobFactors: {} },
    legs: [{ id: 'leg-two', label: 'Storage stop', type: 'storage', originAddress: '1 Main St', destAddress: '5 Storage Rd' }],
  })
  assert.equal(profiles.length, 3)
  assert.equal(profiles[2].stopId, 'leg:leg-two:destination')
  assert.equal(profiles[2].stopRole, 'storage')
})

test('an existing origin profile does not suppress the required destination profile', () => {
  const origin = createStandardAccessProfile({ id: 'origin', stopId: 'primary-origin', stopRole: 'pickup', label: 'Origin', addressSnapshot: '1 Main St' })
  const profiles = accessProfilesForStops({ lead: { originAddress: '1 Main St', destAddress: '2 King St', jobFactors: { accessProfiles: [origin] } } })
  assert.equal(profiles.some(item => item.stopId === 'primary-destination'), true)
})

test('the same physical stop is not repeated when address formatting differs', () => {
  const profiles = accessProfilesForStops({
    lead: {
      originAddress: '830 Revland Drive',
      originCity: 'Tecumseh',
      destAddress: '327 West Belle River Road',
      destCity: 'Belle River',
      jobFactors: {},
    },
    legs: [{
      id: 'leg-a',
      label: 'Person A pickup',
      type: 'move',
      originAddress: '830 Revland Drive, Tecumseh, Ontario, Canada',
      originCity: 'Tecumseh',
      destAddress: '327 West Belle River Road, Belle River, ON, Canada',
      destCity: 'Belle River',
    }],
  })

  assert.equal(profiles.filter(profile => profile.stopRole === 'pickup').length, 1)
  assert.equal(profiles.filter(profile => profile.stopRole === 'dropoff').length, 1)
})
