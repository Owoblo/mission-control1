import assert from 'node:assert/strict'
import test from 'node:test'
import { computeJobPenalties, estimateLeadQuote, getDefaultDepositRate, reconcileEstimatedQuoteLineItems } from '../../lib/sales'
import type { CRMLead, JobFactors, QuoteLeg } from '../../lib/types'

function makeLead(overrides: Partial<CRMLead> = {}): CRMLead {
  return {
    id: 'lead_estimate_1',
    name: 'Multi Leg Customer',
    stage: 'new',
    createdAt: '2026-05-14',
    moveType: 'residential',
    inventory: [
      { name: 'Sectional Sofa', room: 'Living Room', qty: 1, cubicFeet: 90, weightLbs: 240, included: true, source: 'manual' },
      { name: 'King Bed Frame', room: 'Primary Bedroom', qty: 1, cubicFeet: 55, weightLbs: 180, included: true, source: 'manual' },
      { name: 'Mattress', room: 'Primary Bedroom', qty: 1, cubicFeet: 35, weightLbs: 110, included: true, source: 'manual' },
      { name: 'Wardrobe Boxes', room: 'Bedroom 2', qty: 12, cubicFeet: 72, weightLbs: 180, included: true, source: 'manual' },
      { name: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 45, weightLbs: 120, included: true, source: 'manual' },
    ],
    totalItems: 16,
    totalCubicFeet: 297,
    totalWeightLbs: 830,
    callLogs: [],
    roomBreakdown: {
      'Living Room': 1,
      'Primary Bedroom': 2,
      'Bedroom 2': 12,
      'Dining Room': 1,
    },
    ...overrides,
  }
}

test('deposit policy uses 30% locally, 50% long-distance, and invoices commercial work', () => {
  assert.equal(getDefaultDepositRate('residential'), 0.3)
  assert.equal(getDefaultDepositRate('labor-only'), 0.3)
  assert.equal(getDefaultDepositRate('packing'), 0.3)
  assert.equal(getDefaultDepositRate('long-distance'), 0.5)
  assert.equal(getDefaultDepositRate('commercial'), 0)
})

test('quote line-item reconciliation is stable when the estimate is unchanged', () => {
  const current = [
    { description: 'Full-Service Moving', details: '4 professional movers', amount: 3552.5 },
  ]

  const reconciled = reconcileEstimatedQuoteLineItems(current, [
    { description: 'Full-Service Moving', details: '4 professional movers', amount: 3552.5 },
  ])

  assert.equal(reconciled, current, 'an unchanged estimate must preserve the state reference')
})

test('quote line-item reconciliation updates calculated rows and preserves manual rows', () => {
  const manual = { description: 'Piano handling', details: 'Upright piano', amount: 250 }
  const current = [
    { description: 'Full-Service Moving', details: '3 professional movers', amount: 2400 },
    manual,
  ]

  const reconciled = reconcileEstimatedQuoteLineItems(current, [
    { description: 'Full-Service Moving', details: '4 professional movers', amount: 3552.5 },
  ])

  assert.deepEqual(reconciled, [
    { description: 'Full-Service Moving', details: '4 professional movers', amount: 3552.5 },
    manual,
  ])
})

test('rep-entered specialty pricing survives automatic estimate recalculation', () => {
  const manualSpecialty = {
    description: 'Specialty Item Handling',
    details: 'Upright piano — rep confirmed',
    amount: 275,
    pricingSource: 'manual' as const,
  }
  const reconciled = reconcileEstimatedQuoteLineItems([
    { description: 'Full-Service Moving', details: '3 movers', amount: 2400 },
    manualSpecialty,
  ], [
    { description: 'Full-Service Moving', details: '4 movers', amount: 3552.5 },
    { description: 'Specialty Item Handling', details: 'Upright piano', amount: 0 },
  ])
  assert.deepEqual(reconciled, [
    { description: 'Full-Service Moving', details: '4 movers', amount: 3552.5 },
    manualSpecialty,
  ])
})

test('quote line-item reconciliation protects local and long-distance locked prices', () => {
  for (const description of [
    'Moving Services — Agreed Rate',
    'Long-Distance Moving Service — All Inclusive',
  ]) {
    const current = [{ description, details: 'Rep-approved fixed price', amount: 3000 }]
    const reconciled = reconcileEstimatedQuoteLineItems(current, [
      { description: 'Full-Service Moving', details: 'Calculated price', amount: 5000 },
    ])
    assert.equal(reconciled, current)
  }
})

test('small hourly moves include dispatch base and short-notice priority pricing', () => {
  const moveDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
  const estimate = estimateLeadQuote(makeLead({ moveDate }), {
    quoteType: 'standard',
    routeContext: {
      pricingStatus: 'ready',
      routeCategory: 'local',
      billableDriveHours: 0.5,
      operationalDriveHours: 0.5,
      billableDistanceKm: 15,
      operationalDistanceKm: 15,
    },
  })

  assert.equal(estimate.lineItems.find(item => item.description === 'Move readiness & dispatch base')?.amount, 100)
  assert.equal(estimate.lineItems.find(item => item.description === 'Priority booking surcharge')?.amount, 200)
  assert.equal(estimate.pricingBreakdown.internalCostEstimate.commissionCost, 0)
})

test('long-distance pricing stays within the selected one-way truck capacity band', () => {
  const routeContext = {
    pricingStatus: 'ready' as const,
    routeCategory: 'long-distance' as const,
    originToDestinationHours: 20,
    returnTripHours: 0,
    billableDriveHours: 20,
    operationalDriveHours: 20,
    billableDistanceKm: 2000,
    operationalDistanceKm: 2000,
  }
  const overrides = {
    quoteType: 'long_distance' as const,
    crewSize: 3,
    longDistanceTruckCost: 4200,
    longDistanceGasCost: 1800,
    longDistanceInsuranceCost: 300,
    longDistanceMiscCost: 250,
    longDistanceMarkupRate: 40,
    routeContext,
  }
  const partialTruck = estimateLeadQuote(makeLead({ totalCubicFeet: 600, totalWeightLbs: 3000 }), overrides)
  const fullTruck = estimateLeadQuote(makeLead({ totalCubicFeet: 1600, totalWeightLbs: 6000 }), overrides)

  assert.equal(partialTruck.truckCount, 1)
  assert.equal(fullTruck.truckCount, 1, 'long-distance quote type must use the 1,700 cu ft capacity even when the lead began as residential')
  assert.equal(fullTruck.estimatedHours, partialTruck.estimatedHours)
  assert.equal(fullTruck.subtotal, partialTruck.subtotal)
})

test('premium scope follows inventory evidence and never invents TV mounting', () => {
  const base = makeLead({
    surveyCompletedAt: '2026-08-13T18:00:00.000Z',
    inventory: [
      { name: 'King Bed Frame', room: 'Bedroom', qty: 1, cubicFeet: 55, weightLbs: 180, included: true, source: 'survey_ai' },
      { name: '65-inch TV', room: 'Living Room', qty: 1, cubicFeet: 8, weightLbs: 45, included: true, source: 'survey_ai' },
    ],
  })
  const standardTv = estimateLeadQuote(base, { quoteType: 'standard' })
  assert.ok(standardTv.lineItems.some(item => item.description === 'Moving Boxes — As Many As Needed'))
  assert.ok(!standardTv.lineItems.some(item => /Professional Packing|Professional Unpacking/.test(item.description)))
  assert.ok(standardTv.lineItems.some(item => item.description === 'Inventory-Specific Disassembly & Reassembly'))
  assert.ok(standardTv.lineItems.some(item => item.description === 'TV Protection'))
  assert.ok(!standardTv.lineItems.some(item => item.description === 'Wall-Mounted TV Dismount & Remount'))

  const mountedTv = estimateLeadQuote({
    ...base,
    inventory: base.inventory?.map(item => /tv/i.test(item.name || '') ? { ...item, notes: 'wall-mounted TV visible in customer photo' } : item),
  }, { quoteType: 'standard' })
  assert.ok(mountedTv.lineItems.some(item => item.description === 'Wall-Mounted TV Dismount & Remount'))
})

test('packing preference alone does not silently add packing to the quote', () => {
  const estimate = estimateLeadQuote(makeLead({
    surveyCompletedAt: '2026-08-13T18:00:00.000Z',
    jobFactors: { packingPreference: 'full_service' },
  }), { quoteType: 'standard' })
  assert.ok(!estimate.lineItems.some(item => /Professional Packing|Professional Unpacking/.test(item.description)))
})

test('estimateLeadQuote prices storage, storage delivery, and secondary stop legs distinctly', () => {
  const lead = makeLead()
  const factors: JobFactors = {
    estimatedBoxes: 40,
    packingStatus: 'not-started',
    disassemblyItemCount: 2,
  }
  const legs: QuoteLeg[] = [
    {
      id: 'leg_storage',
      label: 'House to Storage',
      type: 'storage',
      originAddress: '123 Main St',
      originCity: 'Ottawa',
      destAddress: '77 Storage Way',
      destCity: 'Ottawa',
      routeCategory: 'local',
      pricingStatus: 'ready',
      billableDistanceKm: 14,
      operationalDistanceKm: 14,
      billableDriveHours: 0.5,
      operationalDriveHours: 0.5,
      yardToOriginHours: 0.25,
      returnTripHours: 0.25,
      inventorySharePct: 100,
      scheduledDate: '2026-06-10',
    },
    {
      id: 'leg_delivery',
      label: 'Storage to New Home',
      type: 'storage_delivery',
      originAddress: '77 Storage Way',
      originCity: 'Ottawa',
      destAddress: '999 River Rd',
      destCity: 'Ottawa',
      routeCategory: 'local',
      pricingStatus: 'ready',
      billableDistanceKm: 18,
      operationalDistanceKm: 18,
      billableDriveHours: 0.75,
      operationalDriveHours: 0.75,
      yardToOriginHours: 0.25,
      returnTripHours: 0.25,
      inventorySharePct: 70,
      scheduledDate: '2026-06-12',
    },
    {
      id: 'leg_extra_stop',
      label: 'Boyfriend Drop',
      type: 'delivery',
      originAddress: '999 River Rd',
      originCity: 'Ottawa',
      destAddress: '25 Pine Ave',
      destCity: 'Ottawa',
      routeCategory: 'local',
      pricingStatus: 'ready',
      billableDistanceKm: 6,
      operationalDistanceKm: 6,
      billableDriveHours: 0.25,
      operationalDriveHours: 0.25,
      yardToOriginHours: 0,
      returnTripHours: 0,
      inventorySharePct: 30,
      scheduledDate: '2026-06-12',
    },
  ]

  const estimate = estimateLeadQuote(
    lead,
    {
      quoteType: 'standard',
      routeContext: {
        routeCategory: 'local',
        pricingStatus: 'ready',
        originToDestinationHours: 0.5,
        yardToOriginHours: 0.25,
        returnTripHours: 0.25,
        billableDriveHours: 0.75,
        operationalDriveHours: 0.75,
        originToDestinationDistanceKm: 14,
        yardToOriginDistanceKm: 8,
        returnTripDistanceKm: 14,
        billableDistanceKm: 22,
        operationalDistanceKm: 36,
      },
      legs,
    },
    factors
  )

  assert.equal(estimate.lineItems.length, 3)
  assert.ok((estimate.pricingBreakdown.intelligenceFlags.packingDayEstimate?.crewSize || 0) >= 2)
  assert.ok((estimate.pricingBreakdown.intelligenceFlags.packingDayEstimate?.hours || 0) >= 4)
  assert.ok(estimate.pricingBreakdown.adjustmentBreakdown.some(item => item.category === 'packing'))
  assert.ok(estimate.pricingBreakdown.adjustmentBreakdown.some(item => item.category === 'disassembly'))
  assert.match(estimate.lineItems[0].description, /\[Leg 1\] House to Storage/)
  assert.match(estimate.lineItems[0].details || '', /disassembly only at pickup/i)
  assert.match(estimate.lineItems[1].description, /\[Leg 2\] Storage to New Home/)
  assert.match(estimate.lineItems[1].details || '', /reassemble at destination/i)
  assert.match(estimate.lineItems[2].description, /\[Leg 3\] Boyfriend Drop/)
  assert.match(estimate.lineItems[2].details || '', /same load, extra stop on route/i)
  assert.match(estimate.lineItems[2].details || '', /30% of the overall shipment/i)
  assert.ok(estimate.pricingBreakdown.moveIntelligence?.risks.some(risk => risk.includes('3 operational legs')))
  assert.ok(estimate.pricingBreakdown.moveIntelligence?.questions.some(question => question.id === 'storage-access:leg_storage'))
})

test('estimateLeadQuote ignores an empty multi-leg placeholder row', () => {
  const lead = makeLead()
  const direct = estimateLeadQuote(lead, { quoteType: 'standard' })
  const withPlaceholder = estimateLeadQuote(lead, {
    quoteType: 'standard',
    legs: [{ id: 'blank', label: '', type: 'move' }],
  })

  assert.equal(withPlaceholder.total, direct.total)
  assert.equal(withPlaceholder.estimatedHours, direct.estimatedHours)
  assert.equal(withPlaceholder.lineItems.some(line => /^\[Leg /.test(line.description)), false)
})

test('estimateLeadQuote keeps standard moving jobs at a two-mover minimum', () => {
  const lead = makeLead({
    inventory: [],
    totalItems: 0,
    totalCubicFeet: 0,
    totalWeightLbs: 0,
  })

  const estimate = estimateLeadQuote(lead, {
    quoteType: 'standard',
    routeContext: {
      routeCategory: 'local',
      pricingStatus: 'ready',
      originToDestinationHours: 0.25,
      yardToOriginHours: 0.25,
      returnTripHours: 0.25,
      billableDriveHours: 0.25,
      operationalDriveHours: 0.75,
      originToDestinationDistanceKm: 4,
      yardToOriginDistanceKm: 3,
      returnTripDistanceKm: 5,
      billableDistanceKm: 7,
      operationalDistanceKm: 12,
    },
  })

  assert.equal(estimate.crewSize, 2)
  assert.match(estimate.lineItems[0].details || '', /2 professional movers/)
})

test('estimateLeadQuote includes return-to-yard travel when local route context omits a billable total', () => {
  const estimate = estimateLeadQuote(makeLead({ totalCubicFeet: 80, totalWeightLbs: 410 }), {
    quoteType: 'standard',
    routeContext: {
      routeCategory: 'medium',
      pricingStatus: 'ready',
      yardToOriginHours: 0.25,
      originToDestinationHours: 1.5,
      returnTripHours: 1.5,
      yardToOriginDistanceKm: 4,
      originToDestinationDistanceKm: 119,
      returnTripDistanceKm: 103,
    },
  })

  assert.equal(estimate.pricingBreakdown.driveHours, 3.25)
})

test('estimateLeadQuote applies commercial direct costs and markup to margin math', () => {
  const estimate = estimateLeadQuote(
    makeLead({
      moveType: 'commercial',
      totalCubicFeet: 900,
      totalWeightLbs: 2600,
    }),
    {
      quoteType: 'standard',
      routeContext: {
        routeCategory: 'local',
        pricingStatus: 'ready',
        originToDestinationHours: 0.5,
        yardToOriginHours: 0.25,
        returnTripHours: 0.25,
        billableDriveHours: 0.75,
        operationalDriveHours: 1,
        billableDistanceKm: 18,
        operationalDistanceKm: 28,
      },
    },
    {
      commercialProtectionCost: 120,
      commercialLiabilityCost: 80,
      commercialAdminCost: 50,
      commercialOtherDirectCost: 25,
      commercialMarkupRate: 10,
    }
  )

  const cost = estimate.pricingBreakdown.internalCostEstimate
  assert.equal(cost.commercialDirectCost, 275)
  assert.ok((cost.commercialMarkupAmount || 0) > 0)
  assert.ok(!estimate.lineItems.some(item => item.description === 'Commercial logistics markup'))
  assert.match(estimate.lineItems[0].details || '', /commercial coordination and scope management included/i)
  assert.equal(estimate.deposit, 0)
  assert.equal(estimate.balance, estimate.total)
  assert.equal(cost.totalCost, cost.laborCost + cost.truckOpsCost + (cost.commissionCost || 0) + (cost.suppliesCost || 0) + 275)
  assert.equal(cost.computedRevenue, estimate.subtotal)
})

test('estimateLeadQuote clears stale parking penalties for obvious house-to-house moves', () => {
  const estimate = estimateLeadQuote(
    makeLead({
      originAddress: '70 Peachtree Crescent, Cambridge, ON, Canada',
      destAddress: '106 Highland Park, Cambridge, ON, Canada',
      propertyType: 'detached_house',
      jobFactors: {
        originFloors: 1,
        originHasElevator: false,
        originParkingOk: false,
        destFloors: 1,
        destHasElevator: false,
        destParkingOk: false,
      },
    }),
    {
      quoteType: 'standard',
      routeContext: {
        routeCategory: 'local',
        pricingStatus: 'ready',
        originToDestinationHours: 0.25,
        yardToOriginHours: 0.5,
        returnTripHours: 0.25,
        billableDriveHours: 0.75,
        operationalDriveHours: 1,
        billableDistanceKm: 33,
        operationalDistanceKm: 40,
      },
    }
  )

  assert.equal(
    estimate.pricingBreakdown.adjustmentBreakdown.find(item => item.category === 'access')?.hours || 0,
    0
  )
  assert.ok(!estimate.pricingBreakdown.penalties.some(item => /limited truck access/i.test(item.label)))
})

test('estimateLeadQuote clears stale elevator flags for obvious house-to-house moves', () => {
  const estimate = estimateLeadQuote(
    makeLead({
      originAddress: '70 Peachtree Crescent, Cambridge, ON, Canada',
      destAddress: '106 Highland Park, Cambridge, ON, Canada',
      propertyType: 'detached_house',
      jobFactors: {
        originFloors: 1,
        originHasElevator: true,
        originElevatorReserved: false,
        originParkingOk: true,
        destFloors: 1,
        destHasElevator: true,
        destElevatorReserved: false,
        destParkingOk: true,
      },
    }),
    {
      quoteType: 'standard',
      routeContext: {
        routeCategory: 'local',
        pricingStatus: 'ready',
        originToDestinationHours: 0.25,
        yardToOriginHours: 0.5,
        returnTripHours: 0.25,
        billableDriveHours: 0.75,
        operationalDriveHours: 1,
        billableDistanceKm: 33,
        operationalDistanceKm: 40,
      },
    }
  )

  assert.equal(
    estimate.pricingBreakdown.adjustmentBreakdown.find(item => item.category === 'access')?.hours || 0,
    0
  )
  assert.ok(!estimate.pricingBreakdown.penalties.some(item => /elevator not reserved/i.test(item.label)))
})

test('estimateLeadQuote treats storage quote type as trucked storage service, not labor-only', () => {
  const estimate = estimateLeadQuote(
    makeLead({
      quoteType: 'storage',
      originAddress: '123 Main St, Ottawa, ON, Canada',
      destAddress: '77 Storage Way, Ottawa, ON, Canada',
    }),
    {
      quoteType: 'storage',
      routeContext: {
        routeCategory: 'local',
        pricingStatus: 'ready',
        originToDestinationHours: 0.25,
        yardToOriginHours: 0.5,
        returnTripHours: 0.25,
        billableDriveHours: 0.75,
        operationalDriveHours: 1,
        billableDistanceKm: 22,
        operationalDistanceKm: 36,
      },
    }
  )

  assert.equal(estimate.lineItems[0].description, 'Storage Load/Unload Service')
  assert.match(estimate.lineItems[0].details || '', /furniture wrapping & padding/)
  assert.match(estimate.lineItems[0].details || '', /yard-to-home travel covered/)
  assert.equal(estimate.pricingBreakdown.driveHours, 0.75)
})

test('computeJobPenalties prices conjoint second pickup apartment access', () => {
  const result = computeJobPenalties({
    conjointMove: true,
    originFloors: 6,
    originHasElevator: true,
    originElevatorReserved: true,
    originParkingOk: true,
    personBOriginFloors: 15,
    personBOriginHasElevator: true,
    personBOriginElevatorReserved: false,
    personBOriginParkingOk: false,
    destFloors: 1,
    destHasElevator: false,
    destParkingOk: true,
  })

  assert.equal(result.extraHours, 1.5)
  assert.ok(result.penalties.some(item => item.label === 'Second pickup – elevator not reserved (shared, wait time)' && item.hours === 0.75))
  assert.ok(result.penalties.some(item => item.label === 'Second pickup – limited truck access' && item.hours === 0.75))
})

test('estimateLeadQuote prices conjoint second pickup as incremental load plus final unload', () => {
  const lead = makeLead({
    inventory: [
      { name: 'Person A furniture', room: 'Living Room', qty: 1, cubicFeet: 1023, weightLbs: 5238, included: true, source: 'manual' },
      { name: 'Person B furniture', room: 'Bedroom', qty: 1, cubicFeet: 115, weightLbs: 590, included: true, source: 'manual', owner: 'person_b' },
    ],
    totalItems: 2,
    totalCubicFeet: 1138,
    totalWeightLbs: 5828,
    jobFactors: { conjointMove: true, personALabel: 'A', personBLabel: 'Person B' },
  })

  const estimate = estimateLeadQuote(lead, {
    quoteType: 'standard',
    legs: [
      {
        id: 'leg_a',
        label: 'Leg 1 — Person A pickup',
        type: 'move',
        originAddress: '136 Marcy Crescent',
        destAddress: '1245 Franklin Boulevard',
        billableDistanceKm: 6,
        operationalDistanceKm: 6,
        billableDriveHours: 0.25,
        operationalDriveHours: 0.25,
        routeCategory: 'local',
        pricingStatus: 'ready',
        inventorySharePct: 90,
      },
      {
        id: 'leg_b',
        label: 'Leg 2 — Person B pickup + delivery',
        type: 'move',
        originAddress: '1245 Franklin Boulevard',
        destAddress: '55 McFarlane Drive',
        billableDistanceKm: 4,
        operationalDistanceKm: 4,
        billableDriveHours: 0.25,
        operationalDriveHours: 0.25,
        routeCategory: 'local',
        pricingStatus: 'ready',
        inventorySharePct: 100,
      },
    ],
  }, lead.jobFactors)

  assert.match(estimate.lineItems[0].details || '', /loads ~90%/)
  assert.match(estimate.lineItems[1].details || '', /loads remaining ~10%/)
  assert.equal(estimate.pricingBreakdown.bufferHours, 0)
  assert.ok(estimate.pricingBreakdown.loadHours < 23, `load hours should not double count: ${estimate.pricingBreakdown.loadHours}`)
  assert.ok(estimate.estimatedHours < 31, `conjoint estimate should stay under duplicated 40h quote: ${estimate.estimatedHours}`)
})
