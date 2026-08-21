import assert from 'node:assert/strict'
import test from 'node:test'

import { assessMoveIntelligence, deriveItemHandlingProfile, evaluateQuoteIntelligenceSafety } from '../../lib/move-intelligence'
import type { CRMLead, CRMQuote, InventoryItem } from '../../lib/types'

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    name: 'Dining chair',
    room: 'dining room',
    roomId: 'dining_room_main',
    qty: 1,
    cubicFeet: 10,
    weightLbs: 18,
    included: true,
    status: 'confirmed',
    source: 'customer_verification',
    confidence: 1,
    ...overrides,
  }
}

test('compact ordinary furniture remains standard handling', () => {
  const profile = deriveItemHandlingProfile(item())
  assert.equal(profile.level, 'standard')
  assert.equal(profile.requiredMovers, 1)
  assert.equal(profile.flags.length, 0)
})

test('explicit sleeper sofa is recognized without exact product identification', () => {
  const profile = deriveItemHandlingProfile(item({ name: 'Large upholstered sleeper sofa', cubicFeet: 80, weightLbs: 245 }))
  assert.ok(profile.sleeperProbability >= 0.9)
  assert.ok(profile.flags.includes('sleeper_mechanism'))
  assert.ok(['high', 'specialty'].includes(profile.level))
  assert.ok(profile.requiredMovers >= 2)
})

test('ordinary sofa creates one targeted sleeper question', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: 'Large three-seat sofa', cubicFeet: 75, weightLbs: 220, originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, destFloors: 1, originHasElevator: false, destHasElevator: false, originParkingOk: true, destParkingOk: true },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.equal(assessment.questions.filter(question => question.id.startsWith('sleeper:')).length, 1)
})

test('verified upstairs sleeper sofa adds transparent path time', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: 'Sleeper sofa', cubicFeet: 75, weightLbs: 260, originFloor: 2, destinationFloor: 3 })],
    jobFactors: {
      originFloors: 2,
      destFloors: 3,
      originHasElevator: false,
      destHasElevator: false,
      originParkingOk: true,
      destParkingOk: true,
      originAccessStatus: 'verified',
      destAccessStatus: 'verified',
    },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.ok(assessment.pricedExtraHours > 0)
  assert.equal(assessment.paths[0].originStairFlights.status, 'verified')
  assert.equal(assessment.paths[0].destinationStairFlights.value, 2)
})

test('inferred upstairs path creates risk but never a silent surcharge', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: 'King bed frame', room: 'primary bedroom', roomId: 'bedroom_1', cubicFeet: 85, weightLbs: 180, originFloor: undefined, destinationFloor: undefined, source: 'survey_ai', confidence: 0.9 })],
    jobFactors: { originFloors: 3, destFloors: 2, originHasElevator: false, destHasElevator: false },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.equal(assessment.pricedExtraHours, 0)
  assert.equal(assessment.paths[0].originFloor.status, 'inferred')
  assert.ok(assessment.questions.some(question => question.id.startsWith('origin-floor:')))
})

test('basement treadmill is escalated and asks both placement questions', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: 'Large treadmill', room: 'basement rec room', roomId: 'basement_rec', cubicFeet: 65, weightLbs: 280, source: 'survey_ai' })],
    jobFactors: { originFloors: 2, originHasElevator: false, destFloors: 2, destHasElevator: false },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.ok(assessment.highComplexityItemCount >= 1)
  assert.ok(assessment.paths[0].originFloor.value === -1)
  assert.ok(assessment.questions.some(question => question.id.startsWith('destination-floor:')))
})

test('unreserved elevator forces manual review with a critical question', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 8, destinationFloor: 1 })],
    jobFactors: { originFloors: 8, originHasElevator: true, originElevatorReserved: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
    originAddress: 'Unit 801, 1 Tower St',
    destinationAddress: '2 Destination St',
  })
  assert.equal(assessment.fixedPriceReadiness, 'manual_review')
  assert.ok(assessment.questions.some(question => question.id === 'origin-elevator' && question.impact === 'critical'))
})

test('poor truck access asks for position and carry distance', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, destFloors: 1, originHasElevator: false, destHasElevator: false, originParkingOk: false, destParkingOk: true },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.ok(assessment.questions.some(question => question.id === 'truck-position'))
  assert.ok(assessment.accessComplexityScore >= 20)
})

test('five inventory records do not make an incomplete job fixed-price ready', () => {
  const inventory = Array.from({ length: 5 }, (_, index) => item({ id: `item-${index}`, status: undefined, source: 'survey_ai', confidence: 0.55 }))
  const assessment = assessMoveIntelligence({ inventory })
  assert.notEqual(assessment.fixedPriceReadiness, 'ready')
  assert.ok(assessment.readinessReasons.some(reason => reason.includes('addresses')))
})

test('well-confirmed bungalow scope can become fixed-price ready', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: {
      originFloors: 1,
      originHasElevator: false,
      originParkingOk: true,
      destFloors: 1,
      destHasElevator: false,
      destParkingOk: true,
      originAccessStatus: 'verified',
      destAccessStatus: 'verified',
    },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.equal(assessment.fixedPriceReadiness, 'ready')
  assert.equal(assessment.uncertaintyPct, 0)
})

test('specialty safe requires manual review even with complete addresses and floors', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: '400 lb gun safe', cubicFeet: 30, weightLbs: 400, originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
  })
  assert.equal(assessment.fixedPriceReadiness, 'manual_review')
  assert.ok(assessment.paths[0].handling.specialEquipment.includes('specialty handling review'))
})

test('excluded inventory never affects complexity or questions', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ name: 'Grand piano', weightLbs: 700, included: false })],
    jobFactors: {},
  })
  assert.equal(assessment.paths.length, 0)
  assert.equal(assessment.highComplexityItemCount, 0)
  assert.equal(assessment.questions.length, 0)
})

test('binding send safety blocks unresolved specialty scope but hourly remains sendable', () => {
  const lead = {
    id: 'lead-1', name: 'Test', stage: 'pricing', createdAt: '2026-01-01', originAddress: '1 Origin St', destAddress: '2 Destination St',
    inventory: [item({ name: '400 lb safe', weightLbs: 400, originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
  } as CRMLead
  const quote = {
    id: 'quote-1', number: 'Q-1', clientId: 'client-1', leadId: lead.id, status: 'draft', lineItems: [], subtotal: 100, hst: 13, total: 113, deposit: 20, balance: 93, createdAt: '2026-01-01', originAddress: lead.originAddress, destAddress: lead.destAddress,
  } as CRMQuote
  assert.equal(evaluateQuoteIntelligenceSafety(lead, { ...quote, billingModel: 'binding' }).allowed, false)
  assert.equal(evaluateQuoteIntelligenceSafety(lead, { ...quote, billingModel: 'hourly_actuals' }).allowed, true)
  const approvedLead = { ...lead, jobFactors: { ...lead.jobFactors, moveIntelligenceApprovedAt: '2026-01-02T12:00:00.000Z' } }
  const quoteReadyLead = {
    ...approvedLead,
    inventoryVerification: { completedAt: '2026-01-02T12:00:00.000Z', completedBy: 'customer' },
    jobFactors: {
      ...approvedLead.jobFactors,
      packingStatus: 'packed' as const,
      hiddenInventoryCoverage: {
        basement: { state: 'not_applicable' as const, note: 'No basement' }, garage: { state: 'customer_confirmed' as const, note: 'Customer confirmed empty' },
        outdoor: { state: 'not_applicable' as const, note: 'No outdoor storage' }, storage: { state: 'customer_confirmed' as const, note: 'Two closet bins included' },
        boxes: { state: 'estimated' as const, note: 'Customer packing estimate', estimatedCountMin: 20, estimatedCountMax: 25 },
      },
    },
  }
  assert.equal(evaluateQuoteIntelligenceSafety(quoteReadyLead, { ...quote, billingModel: 'binding' }).allowed, true)
})

test('multi-leg binding quote cannot hide a missing intermediate destination', () => {
  const lead = {
    id: 'lead-multi', name: 'Multi Leg', stage: 'pricing', createdAt: '2026-01-01', originAddress: '1 Origin St', destAddress: '9 Final St',
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
  } as CRMLead
  const quote = {
    id: 'quote-multi', number: 'Q-MULTI', clientId: 'client-1', leadId: lead.id, status: 'draft', billingModel: 'binding', lineItems: [], subtotal: 100, hst: 13, total: 113, deposit: 20, balance: 93, createdAt: '2026-01-01',
    legs: [
      { id: 'pickup', label: 'Home to storage', type: 'storage', originAddress: '1 Origin St', destAddress: '22 Storage Rd', inventorySharePct: 100, notes: 'Facility access confirmed' },
      { id: 'delivery', label: 'Storage to final home', type: 'storage_delivery', originAddress: '22 Storage Rd', inventorySharePct: 100, notes: 'Facility access confirmed' },
    ],
  } as CRMQuote
  const safety = evaluateQuoteIntelligenceSafety(lead, quote)
  assert.equal(safety.allowed, false)
  assert.ok(safety.assessment.questions.some(question => question.id === 'leg-destination:delivery'))
})

test('complete two-leg storage move accounts for repeated handling and can be approved', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: {
      originFloors: 1, originHasElevator: false, originParkingOk: true,
      destFloors: 1, destHasElevator: false, destParkingOk: true,
      originAccessStatus: 'verified', destAccessStatus: 'verified',
      moveIntelligenceApprovedAt: '2026-08-17T12:00:00.000Z',
    },
    legs: [
      { id: 'in', label: 'Storage in', type: 'storage', originAddress: '1 Home St', destAddress: '22 Storage Rd', inventorySharePct: 100, notes: 'Facility access verified' },
      { id: 'out', label: 'Storage out', type: 'storage_delivery', originAddress: '22 Storage Rd', destAddress: '9 Final St', inventorySharePct: 100, notes: 'Facility access verified' },
    ],
  })
  assert.equal(assessment.fixedPriceReadiness, 'ready')
  assert.ok(assessment.accessComplexityScore >= 32)
  assert.ok(assessment.risks.some(risk => risk.includes('separate storage handling cycle')))
})

test('arbitrary multi-leg scope requires inventory allocation before fixed pricing', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
    legs: [
      { id: 'a', label: 'Pickup A', type: 'move', originAddress: '1 A St', destAddress: '3 Hub St' },
      { id: 'b', label: 'Pickup B', type: 'delivery', originAddress: '2 B St', destAddress: '3 Hub St' },
      { id: 'c', label: 'Final delivery', type: 'delivery', originAddress: '3 Hub St', destAddress: '4 Final St' },
    ],
  })
  assert.ok(assessment.questions.some(question => question.id === 'multi-leg-inventory-scope'))
  assert.notEqual(assessment.fixedPriceReadiness, 'ready')
  assert.ok(assessment.risks.some(risk => risk.includes('3 operational legs')))
})

test('type-only placeholder leg is ignored', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1, destinationFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true, destFloors: 1, destHasElevator: false, destParkingOk: true },
    originAddress: '1 Origin St',
    destinationAddress: '2 Destination St',
    legs: [{ id: 'blank', label: '', type: 'move' }],
  })
  assert.equal(assessment.questions.some(question => question.id.startsWith('leg-')), false)
})

test('single-location labour scope does not invent destination requirements', () => {
  const assessment = assessMoveIntelligence({
    inventory: [item({ originFloor: 1 })],
    jobFactors: { originFloors: 1, originHasElevator: false, originParkingOk: true },
    originAddress: '1 Service St',
    singleLocation: true,
  })
  assert.equal(assessment.readinessReasons.some(reason => /destination|both route/i.test(reason)), false)
  assert.equal(assessment.questions.some(question => question.id.startsWith('destination-')), false)
  assert.equal(assessment.uncertaintyPct, 0)
})
