import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateQuoteReadiness } from '../../lib/quote-readiness'
import type { CRMLead, HiddenInventoryArea, JobFactors } from '../../lib/types'

const areas: HiddenInventoryArea[] = ['basement', 'garage', 'outdoor', 'storage', 'boxes']

function lead(factors: JobFactors): CRMLead {
  return {
    id: 'lead-ready', name: 'Customer', phone: '5195550100', email: 'customer@example.com', stage: 'pricing', createdAt: '2026-08-19', updatedAt: '2026-08-19',
    originAddress: '1 Main St', destAddress: '2 King St', jobFactors: factors,
    inventoryVerification: { completedAt: '2026-08-19', completedBy: 'customer' },
    inventory: [{ id: 'sofa', name: 'Sofa', qty: 1, cubicFeet: 70, weightLbs: 120, included: true, status: 'confirmed', source: 'customer_verification', confidence: 1 }],
  } as CRMLead
}

function completeFactors(): JobFactors {
  return {
    originFloors: 1, originHasElevator: false, originParkingOk: true,
    destFloors: 1, destHasElevator: false, destParkingOk: true,
    packingStatus: 'partial', estimatedBoxes: 40,
    hiddenInventoryCoverage: Object.fromEntries(areas.map(key => [key, { state: key === 'boxes' ? 'estimated' : 'customer_confirmed', note: key === 'boxes' ? 'Customer expects this range after packing' : 'Customer explicitly reviewed this area', ...(key === 'boxes' ? { estimatedCountMin: 35, estimatedCountMax: 45 } : {}) }])) as JobFactors['hiddenInventoryCoverage'],
  }
}

test('all five hidden inventory areas must be resolved independently', () => {
  const factors = completeFactors()
  delete factors.hiddenInventoryCoverage?.garage
  const result = evaluateQuoteReadiness(lead(factors), { billingModel: 'binding', quoteType: 'standard', originAddress: '1 Main St', destAddress: '2 King St' })
  assert.equal(result.quoteReady, false)
  assert.ok(result.blockers.some(item => item.includes('Garage')))
})

test('estimated hidden inventory needs a defensible quantity or volume', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage!.basement = { state: 'estimated' }
  assert.equal(evaluateQuoteReadiness(lead(factors)).quoteReady, false)
  factors.hiddenInventoryCoverage!.basement = { state: 'estimated', estimatedCubicFeet: 80, note: 'Based on customer video walkthrough' }
  assert.equal(evaluateQuoteReadiness(lead(factors)).quoteReady, true)
})

test('a fully resolved move becomes quote ready without a manual checkbox', () => {
  const result = evaluateQuoteReadiness(lead(completeFactors()), { billingModel: 'binding', quoteType: 'standard', originAddress: '1 Main St', destAddress: '2 King St' })
  assert.equal(result.status, 'quote_ready')
  assert.equal(result.quoteReady, true)
  assert.equal(result.inventoryConfidence, 100)
})
