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

test('an unfinished inventory still requires area verification', () => {
  const factors = completeFactors()
  delete factors.hiddenInventoryCoverage?.garage
  const result = evaluateQuoteReadiness({ ...lead(factors), inventoryVerification: undefined }, { billingModel: 'binding', quoteType: 'standard', originAddress: '1 Main St', destAddress: '2 King St' })
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

test('customer-confirmed empty and nonexistent areas satisfy scope evidence', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage!.basement = { state: 'customer_confirmed_empty' }
  factors.hiddenInventoryCoverage!.garage = { state: 'not_applicable' }
  const result = evaluateQuoteReadiness(lead(factors))
  assert.equal(result.quoteReady, true)
  assert.equal(result.hidden.find(area => area.key === 'basement')?.resolved, true)
  assert.equal(result.hidden.find(area => area.key === 'garage')?.resolved, true)
})

test('a fully resolved move becomes quote ready without a manual checkbox', () => {
  const result = evaluateQuoteReadiness(lead(completeFactors()), { billingModel: 'binding', quoteType: 'standard', originAddress: '1 Main St', destAddress: '2 King St' })
  assert.equal(result.status, 'quote_ready')
  assert.equal(result.quoteReady, true)
  assert.equal(result.inventoryConfidence, 100)
})

test('labour-only work needs one service location, not a destination', () => {
  const factors = completeFactors()
  delete factors.destFloors
  delete factors.destHasElevator
  delete factors.destParkingOk
  const laborLead = { ...lead(factors), moveType: 'labor-only' as const, quoteType: 'labor_only' as const, destAddress: undefined }
  const result = evaluateQuoteReadiness(laborLead, { billingModel: 'binding', quoteType: 'labor_only', originAddress: '1 Main St', destAddress: '' })
  assert.equal(result.quoteReady, true)
  assert.ok(!result.blockers.some(item => /destination|both move addresses/i.test(item)))
  assert.equal(result.inventoryConfidence, 100)
})

test('labour-only work still requires its service location', () => {
  const laborLead = { ...lead(completeFactors()), moveType: 'labor-only' as const, quoteType: 'labor_only' as const, originAddress: undefined, destAddress: undefined }
  const result = evaluateQuoteReadiness(laborLead, { billingModel: 'binding', quoteType: 'labor_only', originAddress: '', destAddress: '' })
  assert.equal(result.quoteReady, false)
  assert.ok(result.blockers.includes('Work location is required.'))
})

test('final inventory confirmation carries forward instead of reopening missing template areas', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage = undefined
  const result = evaluateQuoteReadiness(lead(factors))
  assert.equal(result.quoteReady, true)
  assert.equal(result.inventoryConfidence, 100)
  assert.ok(result.hidden.every(area => area.resolved))
})

test('inventory confidence is independent of missing access and explicit empty areas count', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage = Object.fromEntries(areas.map(area => [area, { state: 'customer_confirmed_empty' }]))
  delete factors.originFloors
  delete factors.destFloors
  const result = evaluateQuoteReadiness(lead(factors))
  assert.equal(result.inventoryConfidence, 100)
  assert.equal(result.quoteReady, false)
  assert.ok(result.blockers.some(item => /access/.test(item)))
})

test('a newly reopened area is not erased by an older final confirmation', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage!.garage = { state: 'unknown', updatedAt: '2026-09-28T12:00:00Z' }
  assert.equal(evaluateQuoteReadiness(lead(factors)).hidden.find(area => area.key === 'garage')?.resolved, false)
})

test('new unconfirmed inventory items require fresh final verification', () => {
  const factors = completeFactors()
  factors.hiddenInventoryCoverage = undefined
  const value = lead(factors)
  value.inventory!.push({ name: 'New photo item', cubicFeet: 10, status: 'needs_confirmation' })
  assert.equal(evaluateQuoteReadiness(value).quoteReady, false)
  assert.ok(evaluateQuoteReadiness(value).hidden.some(area => !area.resolved))
})
