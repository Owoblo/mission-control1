import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLinkedMovePlan, storageVolumeScenario } from '../../lib/linked-move-plan'
import { comparePickupRoutes, type RouteMatrix } from '../../lib/pickup-route-plan'
import type { CRMLead, CRMQuote } from '../../lib/types'
const parent = { id: 'original', name: 'Test', stage: 'booked', createdAt: '2026-10-01', moveDate: '2026-11-01', originAddress: 'Home', destAddress: 'Delivery', truckSize: '20ft', truckCountConfirmed: 1,
  inventory: [{ name: 'Household items', qty: 1, cubicFeet: 700, weightLbs: 2000 }], originAccess: 'Ground level, clear route', destAccess: 'Ground level, clear route' } as CRMLead
const quote = { id: 'original-quote', status: 'accepted', crewSize: 3, truckCount: 1 } as CRMQuote
const child = { ...parent, id: 'storage', parentLeadId: 'original', additionalJobKind: 'supplement', additionalJobLabel: 'Storage', originAddress: 'Storage', inventory: [{ name: 'Storage items', qty: 1, cubicFeet: 250, weightLbs: 500 }] } as CRMLead
const extraQuote = { ...quote, id: 'extra', status: 'draft' } as CRMQuote

test('unapproved additional scope never becomes crew inventory or changes original plan version', () => {
  const baseline = buildLinkedMovePlan(parent, quote, [])
  const plan = buildLinkedMovePlan(parent, quote, [{ lead: child, quote: extraQuote }])
  assert.equal(plan.volume, 700)
  assert.equal(plan.pending.length, 1)
  assert.equal(plan.fingerprint, baseline.fingerprint)
  assert.equal(plan.brief, '')
})
test('approved scope combines loads, identifies overload, and invalidates an earlier review after inventory changes', () => {
  const scopes = [{ lead: child, quote: { ...extraQuote, status: 'accepted' as const } }]
  const plan = buildLinkedMovePlan(parent, quote, scopes)
  assert.equal(plan.volume, 950)
  assert.equal(plan.truck.fits, false)
  assert.equal(plan.ready, false)
  assert.match(plan.reasons.join(' '), /exceeds/)
  const reviewed = { ...parent, linkedPlanReview: { fingerprint: plan.fingerprint, reviewedAt: '2026-10-04', reviewedBy: 'Ops', instructions: 'Storage first after gate opens; check loading sequence', plannedHours: 6 } }
  const changed = buildLinkedMovePlan(reviewed, quote, [{ ...scopes[0], lead: { ...child, inventory: [{ name: 'More items', qty: 1, cubicFeet: 300, weightLbs: 800 }] } }])
  assert.equal(changed.reviewCurrent, false)
  assert.notEqual(changed.dispatchFingerprint, plan.dispatchFingerprint)
})
test('crew acknowledgement becomes stale when operations changes stop instructions', () => {
  const scopes = [{ lead: child, quote: { ...extraQuote, status: 'accepted' as const } }]
  const plan = buildLinkedMovePlan(parent, quote, scopes)
  const review = { fingerprint: plan.fingerprint, reviewedAt: '2026-10-04', reviewedBy: 'Ops', instructions: 'Home first', plannedHours: 6 }
  const first = buildLinkedMovePlan({ ...parent, linkedPlanReview: review }, quote, scopes)
  const second = buildLinkedMovePlan({ ...parent, linkedPlanReview: { ...review, instructions: 'Storage first, then home' } }, quote, scopes)
  assert.notEqual(first.dispatchFingerprint, second.dispatchFingerprint)
})
test('separate bookings do not consume the original move truck capacity', () => {
  assert.equal(buildLinkedMovePlan(parent, quote, [{ lead: { ...child, additionalJobKind: 'separate' }, quote }]).volume, 700)
})
test('storage floor dimensions alone cannot establish cubic feet', () => {
  assert.throws(() => storageVolumeScenario(5, 10, 0, 100))
  assert.throws(() => storageVolumeScenario(5, 10, 6, 0))
  assert.equal(storageVolumeScenario(5, 10, 6, 50), 150)
  assert.throws(() => storageVolumeScenario(5, 10, 6, 150))
})
const matrix: RouteMatrix = Object.fromEntries([[0,1,10],[0,2,5],[1,2,9],[2,1,2],[1,3,4],[2,3,7],[3,0,10],[3,1,4],[3,2,7]].map(([a,b,n]) => [`${a}-${b}`, { distanceKm: n, driveHours: n / 60 }]))
const loads = { original: 700, additional: 250, capacity: 900, originalWeight: 2000, additionalWeight: 500, payload: 5700, verified: true }
test('route comparison accounts for directional legs, yard travel and peak load after unloading', () => {
  const options = comparePickupRoutes(matrix, loads)
  assert.equal(options[0].label, 'Additional pickup → original pickup → delivery')
  assert.equal(options[0].distanceKm, 21)
  assert.equal(options[0].capacityStatus, 'exceeds')
  const split = options.find(o => !o.combined)!
  assert.equal(split.peakCubicFeet, 700)
  assert.equal(split.capacityStatus, 'fits')
})
test('missing routes and unknown inventory never yield a confident fit recommendation', () => {
  const partial = { ...matrix }; delete partial['0-2']
  const options = comparePickupRoutes(partial, { ...loads, verified: false })
  assert.ok(options.every(o => o.capacityStatus === 'unverified'))
  assert.ok(options.filter(o => !o.complete).every(o => o.distanceKm === null && o.driveHours === null))
})
test('payload can rule out a truck even when cubic feet fit', () => {
  const options = comparePickupRoutes(matrix, { ...loads, capacity: 1600, payload: 2200 })
  assert.ok(options.filter(o => o.combined).every(o => o.capacityStatus === 'exceeds'))
})
test('an adequately sized, reviewed combined plan becomes dispatchable without changing either quote', () => {
  const larger = { ...parent, truckSize: '26ft' }
  const scopes = [{ lead: child, quote: { ...extraQuote, status: 'accepted' as const } }]
  const originalFinancialSnapshot = JSON.stringify([quote, scopes[0].quote])
  const plan = buildLinkedMovePlan(larger, quote, scopes)
  assert.deepEqual(plan.reasons, [])
  const reviewed = { ...larger, linkedPlanReview: { fingerprint: plan.fingerprint, reviewedAt: '2026-10-04', reviewedBy: 'Ops', instructions: 'Storage first, home second; destination unloading and access confirmed', plannedHours: 6 } }
  assert.equal(buildLinkedMovePlan(reviewed, quote, scopes).ready, true)
  assert.equal(JSON.stringify([quote, scopes[0].quote]), originalFinancialSnapshot)
})
