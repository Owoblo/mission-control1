import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PACKING_PLAN, DEFAULT_TRUCK_HOLD, estimateServicePackage, replaceServicePackage, servicePackageIsStale, planningFollowUp, SERVICE_NAMES } from '../../lib/estimate-services'
import { buildContributionPricingPlan } from '../../lib/contribution-pricing'
const packingPlan = { ...DEFAULT_PACKING_PLAN, pack: true, unpack: 'all' as const, materials: true, rooms: 'Kitchen and two bedrooms', boxes: 40, fragileBoxes: 10, confirmed: true }
test('packing, unpacking and materials have independent costs and selling prices', () => {
 const plan = estimateServicePackage({ packingPlan })
 assert.deepEqual(plan.issues, [])
 assert.equal(plan.packHours, 10)
 assert.equal(plan.unpackHours, 5)
 assert.deepEqual(plan.costs, { packing: 250, unpacking: 125, materials: 160, cleaning: 0, hold: 0 })
 assert.equal(plan.lineItems.length, 3)
 assert.equal(plan.total, 1025)
 assert.ok(!plan.fingerprint.includes('loadedHourlyCost'))
})
test('removing packing leaves unpacking and materials selected and recalculates their costs', () => {
 const initial = replaceServicePackage([{ description: 'Move', amount: 2000 }], { packingPlan })
 const next = replaceServicePackage(initial, { packingPlan: { ...packingPlan, pack: false } })
 assert.equal(next.length, 3)
 assert.ok(!next.some(line => line.description === SERVICE_NAMES.packing))
 assert.ok(next.some(line => line.description === SERVICE_NAMES.unpacking))
 assert.equal(next[0].amount, 2000)
})
test('scope edits invalidate applied prices and must be reapplied', () => {
 const lines = replaceServicePackage([], { packingPlan })
 assert.equal(servicePackageIsStale({ packingPlan }, lines), false)
 assert.equal(servicePackageIsStale({ packingPlan: { ...packingPlan, boxes: 80 } }, lines), true)
 assert.throws(() => replaceServicePackage(lines, { packingPlan: { ...packingPlan, confirmed: false } }))
})
test('invalid quantities, nonfinite costs and invalid margins never produce a package', () => {
 for (const change of [{ boxes: -1 }, { fragileBoxes: 60 }, { loadedHourlyCost: NaN }, { feePct: 20, marginPct: 80 }]) {
  const p = estimateServicePackage({ packingPlan: { ...packingPlan, ...change } })
  assert.ok(p.issues.length > 0)
  assert.equal(p.lineItems.length, 0)
 }
})
test('possible overnight hold is not priced; confirmed hold uses nights and truck count', () => {
 const truckHold = { ...DEFAULT_TRUCK_HOLD, status: 'possible' as const, nights: 1, trucks: 2, truckCostPerNight: 150, secureParkingCostPerNight: 25, extraDeliveryCost: 50, deliveryDate: '2026-11-12', location: 'Secured yard' }
 assert.equal(estimateServicePackage({ truckHold }).costs.hold, 0)
 const factors = { truckHold: { ...truckHold, status: 'confirmed' as const } }
 assert.equal(estimateServicePackage(factors).costs.hold, 400)
 const costed = buildContributionPricingPlan({ currentPrice: 2000, factors, lineItems: estimateServicePackage(factors).lineItems })
 assert.equal(costed.costs.find(cost => cost.key === 'truck_hold')?.amount, 400)
 assert.ok(!costed.costs.some(cost => cost.key === 'storage'))
})
test('contribution recommendation uses the same packing costs as the service package', () => {
 const factors = { packingPlan }
 const plan = estimateServicePackage(factors)
 const contribution = buildContributionPricingPlan({ currentPrice: 2000, factors, lineItems: plan.lineItems })
 assert.equal(contribution.costs.find(cost => cost.key === 'packing_labor')?.amount, 250)
 assert.equal(contribution.costs.find(cost => cost.key === 'unpacking_labor')?.amount, 125)
 assert.equal(contribution.costs.find(cost => cost.key === 'service_materials')?.amount, 160)
})
test('date alternatives and possible hold yield one meaningful follow-up', () => {
 const task = planningFollowUp({ moveDatePlan: { mode: 'alternatives', firstDate: '2026-11-11', secondDate: '2026-11-12', followUpDate: '2026-09-28' }, truckHold: { ...DEFAULT_TRUCK_HOLD, status: 'possible' } })
 assert.equal(task?.date, '2026-09-28')
 assert.match(task!.note, /2026-11-11 or 2026-11-12/)
 assert.match(task!.note, /overnight/)
 assert.equal(planningFollowUp({}), null)
})
