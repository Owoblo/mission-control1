import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOperationalTimeBudget, roundPlanningHours } from '../../lib/operational-time-budget'
import type { AccessProfile, PricingBreakdown } from '../../lib/types'

function pricing(overrides: Partial<PricingBreakdown> = {}) {
  return {
    loadHours: 3,
    unloadHours: 2.5,
    driveHours: 2,
    operationalDriveHours: 2,
    bufferHours: 0.75,
    routeCategory: 'local' as const,
    adjustmentBreakdown: [
      { category: 'disassembly' as const, label: 'Assembly', hours: 1.5 },
    ],
    ...overrides,
  }
}

const origin: AccessProfile = {
  id: 'origin', stopId: 'primary-origin', stopRole: 'pickup', label: 'Origin',
  propertyType: 'high_rise', walkToEntrance: '1_2', entranceToVerticalAccess: 'under_1', verticalAccessToUnit: 'under_1',
  verticalMode: 'elevator', elevatorType: 'freight', elevatorReservation: 'confirmed', evidenceStatus: 'customer_confirmed',
}

const destination: AccessProfile = {
  id: 'destination', stopId: 'primary-destination', stopRole: 'dropoff', label: 'Destination',
  propertyType: 'high_rise', walkToEntrance: '2_4', entranceToVerticalAccess: '1_2', verticalAccessToUnit: '1_2',
  verticalMode: 'elevator', elevatorType: 'passenger', elevatorReservation: 'shared', buildingCheckIn: true, evidenceStatus: 'customer_confirmed',
}

test('builds one canonical operational budget without changing pricing', () => {
  const budget = buildOperationalTimeBudget({ pricing: pricing(), accessProfiles: [origin, destination], generatedAt: '2026-08-24T00:00:00.000Z' })
  assert.equal(budget.mode, 'shadow')
  assert.equal(budget.workingTime, 5.5)
  assert.equal(budget.serviceTime, 1.5)
  assert.equal(budget.transportationTime, 2)
  assert.equal(budget.allowanceTime, 0.75)
  assert.equal(budget.stops.length, 2)
  assert.ok(budget.accessTime > 0)
  assert.equal(budget.components.find(item => item.key === 'allowance')?.customerVisible, false)
})

test('rounds operational output into useful scheduling blocks', () => {
  assert.equal(roundPlanningHours(0.13), 0.25)
  assert.equal(roundPlanningHours(0.87), 0.75)
  assert.equal(roundPlanningHours(1.24), 1)
  assert.equal(roundPlanningHours(1.26), 1.5)
  assert.equal(roundPlanningHours(2.26), 2.5)
})

test('labor-only single-location plan excludes destination work', () => {
  const budget = buildOperationalTimeBudget({ pricing: pricing(), accessProfiles: [origin, destination], singleLocation: true })
  assert.equal(budget.stops.length, 1)
  assert.equal(budget.workingTime, 3)
  assert.equal(budget.stops.some(stop => stop.role === 'dropoff'), false)
})

test('unsafe or extreme access produces manual review instead of fake certainty', () => {
  const difficult: AccessProfile = {
    ...destination,
    walkToEntrance: 'over_8',
    stairFlights: 5,
    verticalMode: 'stairs',
    unsafeAccess: true,
  }
  const budget = buildOperationalTimeBudget({ pricing: pricing(), accessProfiles: [origin, difficult] })
  assert.ok(budget.manualReviewReasons.length >= 3)
  assert.ok(budget.customerServiceRange.maxHours > budget.customerServiceRange.minHours)
})
