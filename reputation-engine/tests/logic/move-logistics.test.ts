import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveMoveLogisticsPlan } from '../../lib/move-logistics'
import type { InventoryItem, QuoteLeg } from '../../lib/types'

function item(name: string, cubicFeet: number, owner?: InventoryItem['owner']): InventoryItem {
  return { name, room: 'General', qty: 1, cubicFeet, weightLbs: cubicFeet * 4, included: true, source: 'manual', owner }
}

const conjointLegs: QuoteLeg[] = [
  {
    id: 'a_to_b',
    label: 'Person A pickup',
    type: 'move',
    originAddress: '1 First St',
    destAddress: '2 Second St',
    driveHours: 0.5,
    distanceKm: 18,
  },
  {
    id: 'b_to_dest',
    label: 'Person B pickup to destination',
    type: 'move',
    originAddress: '2 Second St',
    destAddress: '3 Final St',
    driveHours: 0.75,
    distanceKm: 22,
  },
]

test('move logistics recommends one-truck sequence when combined volume and hours fit', () => {
  const plan = deriveMoveLogisticsPlan({
    legs: conjointLegs,
    inventory: [item('Sofa', 200), item('Bedroom set', 250, 'person_b')],
    loadHours: 3,
    unloadHours: 2,
    totalHours: 6.5,
    startTime: '09:00',
  })

  assert.equal(plan.recommendation, 'one_truck_sequence')
  assert.equal(plan.truckCount, 1)
  assert.equal(plan.capacityUsedPct, 28)
  assert.equal(plan.finishTime, '3:30 PM')
})

test('move logistics recommends split day for oversized long complex moves', () => {
  const plan = deriveMoveLogisticsPlan({
    legs: conjointLegs,
    inventory: [item('House A load', 1200), item('House B load', 900, 'person_b')],
    loadHours: 8,
    unloadHours: 5,
    totalHours: 14,
    startTime: '08:00',
  })

  assert.equal(plan.recommendation, 'split_day')
  assert.equal(plan.truckCount, 2)
  assert.match(plan.riskNotes.join(' '), /Projected 14h day/)
})

test('move logistics blocks final confidence until leg routes are calculated', () => {
  const plan = deriveMoveLogisticsPlan({
    legs: [{ ...conjointLegs[0], driveHours: undefined, distanceKm: undefined }],
    inventory: [item('Small load', 300)],
    loadHours: 2,
    unloadHours: 1.5,
    totalHours: 4,
  })

  assert.equal(plan.recommendation, 'needs_route_data')
  assert.equal(plan.missingRouteCount, 1)
})

test('move logistics recommends a later start when destination keys are late', () => {
  const plan = deriveMoveLogisticsPlan({
    legs: conjointLegs,
    inventory: [item('Sofa', 200), item('Bedroom set', 250, 'person_b')],
    loadHours: 3,
    unloadHours: 2,
    totalHours: 6.5,
    startTime: '09:00',
    destinationKeysTime: '16:00',
  })

  assert.equal(plan.constraintFit.status, 'adjust_start')
  assert.equal(plan.constraintFit.recommendedStartTime, '11:30')
  assert.match(plan.constraintFit.note, /Start around 11:30/)
})

test('move logistics escalates when timing constraints make the current plan late', () => {
  const plan = deriveMoveLogisticsPlan({
    legs: conjointLegs,
    inventory: [item('House A load', 700), item('House B load', 650, 'person_b')],
    loadHours: 4,
    unloadHours: 2.5,
    totalHours: 8,
    startTime: '09:00',
    latestFinishTime: '15:00',
  })

  assert.equal(plan.constraintFit.status, 'runs_late')
  assert.equal(plan.recommendation, 'two_truck_parallel')
  assert.match(plan.riskNotes.join(' '), /time constraint/)
})
