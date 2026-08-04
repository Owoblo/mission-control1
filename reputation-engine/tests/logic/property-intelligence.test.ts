import assert from 'node:assert/strict'
import test from 'node:test'
import { propertyAccessToJobFactors, type PropertyAccess } from '../../lib/server/property-intelligence'

function property(overrides: Partial<PropertyAccess>): PropertyAccess {
  return {
    propertyType: 'unknown',
    propertyTypeLabel: 'Unknown',
    estimatedFloors: 2,
    unitFloor: null,
    hasElevator: null,
    elevatorReservationLikely: false,
    parkingType: 'unknown',
    carryDistanceEstimate: 'unknown',
    stairsEstimate: 0,
    notes: [],
    confidence: 'low',
    source: [],
    ...overrides,
  }
}

test('property intelligence does not turn estimated building height into a customer floor', () => {
  const factors = propertyAccessToJobFactors(property({
    propertyType: 'condo_highrise',
    estimatedFloors: 15,
    unitFloor: null,
    hasElevator: null,
    elevatorReservationLikely: true,
  }), 'dest')

  assert.equal(factors.destFloors, undefined)
  assert.equal(factors.destHasElevator, undefined)
  assert.equal(factors.destElevatorReserved, undefined)
})

test('normal residential driveway can become a safe parking default without invented stairs', () => {
  const access = property({
    propertyType: 'house_detached',
    propertyTypeLabel: 'Detached House',
    estimatedFloors: 1,
    unitFloor: 1,
    hasElevator: false,
    parkingType: 'driveway',
    carryDistanceEstimate: 'short',
    stairsEstimate: 0,
  })
  const factors = propertyAccessToJobFactors(access, 'origin')

  assert.equal(factors.originFloors, 1)
  assert.equal(factors.originHasElevator, false)
  assert.equal(factors.originParkingOk, true)
  assert.equal(access.stairsEstimate, 0)
})
