import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateLeadQuote } from '../../lib/sales'
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
