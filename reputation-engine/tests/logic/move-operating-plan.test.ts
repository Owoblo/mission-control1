import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAssemblyPlan, preserveInventoryHandlingEvidence } from '../../lib/assembly-planning'
import { buildCurrentCrewBrief, buildMoveOperatingPlan } from '../../lib/move-operating-plan'
import { deriveItemHandlingProfile, evaluateQuoteIntelligenceSafety } from '../../lib/move-intelligence'
import { deriveInventoryMetrics, estimateLeadQuote } from '../../lib/sales'
import { recommendTruckLoadPlan } from '../../lib/truck-planning'
import { truckSizeFromCubicFeet } from '../../lib/uhaul-calculator'
import { finalQuoteMargin, quoteEditConflict } from '../../lib/quote-pricing-safety'
import { customerOutcomeFields, outcomeReviewReasons, validateOperationalOutcome } from '../../lib/move-outcome'
import { recalculateQuoteFromActuals } from '../../lib/server/job-billing'
import type { CRMLead, CRMQuote, InventoryItem } from '../../lib/types'

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return { id: 'audit-fixture', name: 'Furniture move', stage: 'pricing', createdAt: '2026-09-15', moveDate: '2026-10-01', moveType: 'residential',
    inventory: [{ id: 'daybed', name: 'Daybed', qty: 1, cubicFeet: 50, weightLbs: 100 }], ...overrides }
}
function quote(overrides: Partial<CRMQuote> = {}): CRMQuote {
  return { id: 'audit-quote', number: 'AUDIT', clientId: 'fixture', status: 'draft', createdAt: '2026-09-15', crewSize: 3, truckCount: 1, estimatedHours: 7,
    billingModel: 'binding', lineItems: [{ description: 'Moving Services — Agreed Rate', amount: 1000 }], discountAmount: 100,
    subtotal: 900, hst: 117, total: 1017, deposit: 203.4, balance: 813.6, ...overrides }
}

test('all daybed spellings retain complex handling and separate assembly tasks', () => {
  for (const name of ['Daybed', 'Day bed', 'Day-bed', 'Daybed with pullout', 'Trundle bed']) {
    const item = { name, qty: 1, cubicFeet: 50, weightLbs: 100 }
    const plan = buildAssemblyPlan([item])
    assert.equal(plan.tasks.length, 2)
    assert.equal(plan.hours, 1.75)
    assert.equal(plan.personHours, 3.5)
    assert.ok(plan.reviewReasons.length)
    assert.ok(deriveItemHandlingProfile(item).disassemblyLikelihood >= 0.7)
  }
})

test('verified task times preserve quantity, workers, service side and customer responsibility', () => {
  const item: InventoryItem = { id: 'bed', name: 'Daybed', qty: 2, assembly: { responsibility: 'crew', originMinutes: 30, destinationMinutes: 45, workers: 2, evidence: 'Model instructions and operations walkthrough' } }
  assert.equal(buildAssemblyPlan([item]).hours, 2.5)
  assert.equal(buildAssemblyPlan([item], 'disassemble_only').hours, 1)
  assert.equal(buildAssemblyPlan([item], 'reassemble_only').hours, 1.5)
  assert.equal(buildAssemblyPlan([{ ...item, included: false }]).hours, 0)
  assert.equal(buildAssemblyPlan([{ ...item, assembly: { ...item.assembly!, responsibility: 'customer' } }]).hours, 0)
  assert.ok(buildAssemblyPlan([{ ...item, assembly: { ...item.assembly!, responsibility: 'customer', evidence: '' } }]).hours > 0)
})

test('a zero aggregate count cannot erase known assembly work or shrink staffing time', () => {
  const l = lead({ jobFactors: { disassemblyItemCount: 0 } })
  const result = estimateLeadQuote(l, { crewSize: 3 })
  assert.equal(result.pricingBreakdown.assemblyPlan?.hours, 1.75)
  assert.ok(result.pricingBreakdown.penaltyHours >= 1.75)
  const largerCrew = estimateLeadQuote(l, { crewSize: 6 })
  assert.equal(largerCrew.pricingBreakdown.assemblyPlan?.hours, 1.75)
})

test('renaming inventory does not erase a disclosed mechanism or add volume', () => {
  const before = [{ id: 'bed', name: 'Daybed with pullout', cubicFeet: 50 }]
  const after = preserveInventoryHandlingEvidence(before, [{ id: 'bed', name: 'Daybed', cubicFeet: 50 }])
  assert.match(after[0].notes || '', /pullout/)
  assert.equal(deriveInventoryMetrics(after).totalCubicFeet, 50)
})

test('truck helpers agree at every boundary and weight can increase size', () => {
  for (const volume of [0, 249, 250, 251, 599, 600, 601, 687, 899, 900, 901, 1600, 1601]) {
    assert.equal(truckSizeFromCubicFeet(volume), recommendTruckLoadPlan({ totalCubicFeet: volume, truckCount: 1 }).trucks[0].size)
  }
  assert.equal(truckSizeFromCubicFeet(687), '20ft')
  assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 500, totalWeightLbs: 6000 }).trucks[0].size, '26ft')
  assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 687, committedSize: '26ft' }).trucks[0].size, '26ft')
  assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 1800, truckCount: 1, committedSize: '26ft' }).fits, false)
  assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 4000, truckCount: 3 }).trucks.length, 3)
  assert.ok(recommendTruckLoadPlan({ totalCubicFeet: 0 }).reviewReasons.length)
})

test('Ryan failure pattern flags retained mechanism, unknown access and contradictory reservation', () => {
  const l = lead({ truckSize: '26ft', truckReservationStatus: 'not_needed', notes: 'Customer: day bed with pullout',
    inventory: [...lead().inventory!, { name: '6 Seat sectional sofa', room: 'Basement', cubicFeet: 110, weightLbs: 200 }] })
  const plan = buildMoveOperatingPlan(l, quote())
  assert.equal(plan.ready, false)
  assert.equal(plan.truckPlan?.trucks[0].size, '26ft')
  assert.ok(plan.reasons.some(r => /pullout/.test(r)))
  assert.ok(plan.reasons.some(r => /Origin carrying route/.test(r)))
  assert.ok(plan.reasons.some(r => /no truck needed/.test(r)))
  assert.equal(plan.originKnown, false)
  assert.equal(plan.destinationKnown, false)
})

test('review expires on scope, truck, access, date, hours, price or crew changes', () => {
  const q = quote()
  const l = lead({ truckSize: '26ft', originAccess: 'Ground floor', destAccess: 'Ground floor', parkingNotes: 'Driveway' })
  l.operatingReview = { fingerprint: buildMoveOperatingPlan(l, q).fingerprint, reviewedAt: '2026-09-15', reviewedBy: 'Operations', rationale: 'Reviewed dimensions and planned assembly', plannedHours: 9 }
  assert.equal(buildMoveOperatingPlan(l, q).ready, true)
  for (const patch of [{ moveDate: '2026-10-02' }, { truckSize: '20ft' }, { originAccess: 'Second floor' }, { inventory: [{ name: 'Daybed', qty: 2 }] }]) {
    assert.equal(buildMoveOperatingPlan({ ...l, ...patch }, q).ready, false)
  }
  for (const patch of [{ crewSize: 2 }, { estimatedHours: 8 }, { subtotal: 850 }, { discountAmount: 150 }]) {
    assert.equal(buildMoveOperatingPlan(l, { ...q, ...patch }).ready, false)
  }
  assert.equal(buildMoveOperatingPlan({ ...l, lastTouchedAt: '2026-09-16' }, q).ready, true)
})

test('review expires on reservation changes, conflicting truck fields and effective quote date', () => {
  const q = quote({ moveDate: '2026-10-01', truckSize: '26ft' })
  const l = lead({ moveDate: undefined, truckSize: '26ft', truckCountConfirmed: 1 })
  l.operatingReview = { fingerprint: buildMoveOperatingPlan(l, q).fingerprint, reviewedAt: '2026-09-15', reviewedBy: 'Operations', rationale: 'Conservative allowance reviewed', plannedHours: 9 }
  assert.equal(buildMoveOperatingPlan(l, q).ready, true)
  for (const patch of [{ truckReservationStatus: 'not_needed' as const }, { truckCountConfirmed: 2 }, { truckPickupTime: '11:00' }, { truckReservationNumber: 'replacement' }]) {
    assert.equal(buildMoveOperatingPlan({ ...l, ...patch }, q).reviewCurrent, false)
  }
  for (const patch of [{ truckSize: '20ft' }, { moveDate: '2026-10-02' }]) {
    assert.equal(buildMoveOperatingPlan(l, { ...q, ...patch }).reviewCurrent, false)
  }
  const invalid = { ...l, truckReservationStatus: 'not_needed' as const }
  invalid.operatingReview = { ...l.operatingReview, fingerprint: buildMoveOperatingPlan(invalid, q).fingerprint }
  assert.equal(buildMoveOperatingPlan(invalid, q).ready, false)
})

test('operational actuals preserve customer outcomes while allowing explicit corrections', () => {
  const existing = { damage_flag: true, customer_rating: 5, review_left: true, referral_generated: true, notes: 'Damage documented separately' }
  assert.deepEqual(customerOutcomeFields({ operational: { actualHours: 9 } }, existing), existing)
  assert.deepEqual(customerOutcomeFields({ damage_flag: false, notes: null }, existing), { ...existing, damage_flag: false, notes: null })
  assert.deepEqual(customerOutcomeFields({}), { damage_flag: false, customer_rating: null, review_left: false, referral_generated: false, notes: null })
})

test('crew briefing uses current date, billing model and truck rather than stale narrative', () => {
  const l = lead({ moveDate: '2026-10-02', moveTime: '10:00', truckSize: '26ft', crewNote: 'September 11, hourly, 20ft, no alerts, $500 deposit' })
  const brief = buildCurrentCrewBrief(l, quote({ moveDate: '2026-09-11', moveTime: '09:00' }))
  assert.match(brief, /2026-10-02 at 10:00/)
  assert.match(brief, /BINDING/)
  assert.match(brief, /26ft/)
  assert.match(brief, /reassemble, 60 min, 2 worker/)
  assert.doesNotMatch(brief, /September 11|\$500|no alerts/)
})

test('stale price edits are rejected and final margin includes stacked discounts', () => {
  const q = quote({ revision: 4, priceOverrideTotal: 1000 })
  assert.ok(quoteEditConflict(q, { revision: 3, discountAmount: 100 }))
  assert.ok(quoteEditConflict(q, { discountAmount: 100 }))
  assert.equal(quoteEditConflict(q, { revision: 4, discountAmount: 100 }), undefined)
  assert.equal(finalQuoteMargin(q, 591).revenue, 900)
  assert.ok(Math.abs(finalQuoteMargin(q, 591).marginPct - 34.3333) < 0.001)
})

test('recording an overrun never reprices a binding quote even with a justification', () => {
  const q = quote()
  const result = recalculateQuoteFromActuals(q, { actualHours: 11, actualCrew: 4, justification: 'Daybed was difficult and truck needed replacement' })
  assert.equal(result?.quote?.total, q.total)
  assert.equal(result?.quote?.crewSize, 3)
  assert.equal(result?.quote?.estimatedHours, 7)
  assert.equal(result?.adjustmentMode, 'none')
})

test('actuals reject invalid times and do not equate customer satisfaction with a closed review', () => {
  assert.throws(() => validateOperationalOutcome({ actualHours: -1 }))
  assert.throws(() => validateOperationalOutcome({ actualCrew: 2.5 }))
  assert.throws(() => validateOperationalOutcome({ startedAt: '2026-09-14T10:00:00Z', finishedAt: '2026-09-14T09:00:00Z' }))
  assert.throws(() => validateOperationalOutcome({ reviewStatus: 'reviewed', actualHours: 9, actualCrew: 3 }))
  assert.ok(outcomeReviewReasons(7).length)
  const actual = { actualHours: 10, actualCrew: 3, truckSwapMinutes: 45, reviewStatus: 'pending' as const, recordedAt: '2026-09-15', recordedBy: 'Operations' }
  assert.ok(outcomeReviewReasons(7, actual).some(reason => /Time overrun/.test(reason)))
  assert.ok(outcomeReviewReasons(7, actual).some(reason => /Truck exchange/.test(reason)))
})

test('explicit assembly instructions override ordinary furniture exclusions', () => {
  assert.equal(buildAssemblyPlan([{ name: 'Coffee table', notes: 'Disassembly required' }]).tasks.length, 2)
  const malformed = buildAssemblyPlan([{ name: 'Daybed', assembly: { responsibility: 'crew', originMinutes: -10, destinationMinutes: 0, workers: 0, evidence: 'Legacy malformed record' } }])
  assert.equal(malformed.hours, 1.75)
  assert.ok(malformed.tasks.every(task => task.provisional))
})

test('assembly evidence alone does not verify loaded furniture dimensions', () => {
  const plan = recommendTruckLoadPlan({ totalCubicFeet: 687, inventory: [{ name: 'Daybed', assembly: { responsibility: 'crew', originMinutes: 30, destinationMinutes: 45, workers: 2, evidence: 'Assembly instructions' } }] })
  assert.ok(plan.reviewReasons.some(reason => /dimensions/.test(reason)))
})

test('truck plans fail closed on invalid inputs and respect capacity over a broad grid', () => {
  for (const count of [-1, 0, 1.5, 4, NaN, Infinity]) assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 100, truckCount: count }).fits, false)
  for (const weight of [-1, NaN, Infinity]) assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 100, totalWeightLbs: weight }).fits, false)
  assert.equal(recommendTruckLoadPlan({ totalCubicFeet: 100, committedSize: 'unknown' }).fits, false)
  for (let volume = 1; volume <= 5000; volume += 47) {
    for (let weight = 0; weight <= 31000; weight += 3100) {
      const plan = recommendTruckLoadPlan({ totalCubicFeet: volume, totalWeightLbs: weight })
      if (plan.fits) {
        assert.ok(plan.totalUsableCubicFeet >= volume)
        assert.ok(plan.totalPayloadLbs >= weight)
        assert.ok(plan.trucks.length >= 1 && plan.trucks.length <= 3)
      } else assert.ok(plan.reviewReasons.length)
    }
  }
})

test('excluded confirmed inventory requires a recorded reconciliation', () => {
  const plan = buildMoveOperatingPlan(lead({ inventory: [{ name: 'Small freezer', included: false, status: 'confirmed' }] }), quote())
  assert.ok(plan.reasons.some(reason => /confirmed inventory/.test(reason)))
  assert.ok(plan.reasons.some(reason => /why it is excluded/.test(reason)))
})
