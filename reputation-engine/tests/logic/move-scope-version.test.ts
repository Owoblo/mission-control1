import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMoveScopeSnapshot, validateWalkthrough } from '../../lib/move-scope-version'
import type { CRMLead, CRMQuote } from '../../lib/types'

function fixtures() {
  const lead: CRMLead = {
    id: 'lead-1', name: 'Alex Move', stage: 'booked', createdAt: '2026-08-18T10:00:00.000Z',
    originAddress: '1 Origin St', destAddress: '2 Destination St',
    inventoryVerification: { completedAt: '2026-08-18T11:00:00.000Z' },
    inventory: [
      { id: 'sofa', name: 'Sofa', room: 'Living Room', qty: 1, cubicFeet: 70, weightLbs: 180, included: true, source: 'manual' },
      { id: 'added', name: 'Customer-added cabinet', room: 'Garage', qty: 2, included: true, source: 'customer_verification' },
      { id: 'stays', name: 'Desk', room: 'Office', qty: 1, cubicFeet: 25, weightLbs: 60, included: false, exclusionReason: 'Staying behind' },
    ],
  }
  const quote: CRMQuote = {
    id: 'quote-1', number: 'Q-1', clientId: 'client-1', leadId: lead.id, status: 'accepted',
    lineItems: [{ description: 'Moving service', amount: 1000 }], subtotal: 1000, hst: 130, total: 1130, deposit: 339, balance: 791,
    createdAt: '2026-08-18T10:30:00.000Z', crewSize: 3, truckCount: 1, estimatedHours: 6,
  }
  return { lead, quote }
}

test('scope snapshot preserves operational and commercial facts without mutating sources', () => {
  const { lead, quote } = fixtures()
  const scope = buildMoveScopeSnapshot(lead, quote, '2026-08-18T12:00:00.000Z')
  assert.equal(scope.inventoryTotals.itemCount, 3)
  assert.equal(scope.inventoryTotals.expectedCubicFeet, 70)
  assert.equal(scope.inventoryTotals.unknownDimensionItemCount, 2)
  assert.match(scope.unknowns.join(','), /inventory:added:cubic_feet/)
  assert.deepEqual(scope.exclusions, [{ name: 'Desk', room: 'Office', reason: 'Staying behind' }])
  scope.inventory[0].name = 'Changed snapshot'
  assert.equal(lead.inventory?.[0].name, 'Sofa')
})

test('accepted snapshot preserves customer confirmations and labour-only does not invent a destination', () => {
  const { lead, quote } = fixtures()
  lead.moveType = 'labor-only'
  lead.quoteType = 'labor_only'
  lead.destAddress = undefined
  quote.quoteType = 'labor_only'
  const acceptance = {
    acceptedAt: '2026-08-18T12:00:00.000Z',
    termsVersion: '2026-scope-confirmation',
    customerConfirmedScope: true,
    customerConfirmedHiddenAreas: true,
    customerConfirmedAccess: true,
    customerConfirmedSpecialtyItems: true,
    customerAcknowledgedArrivalVerification: true,
    customerAcknowledgedChangeOrders: true,
    ipAddress: '203.0.113.1',
    userAgent: 'Test browser',
  }
  const scope = buildMoveScopeSnapshot(lead, quote, acceptance.acceptedAt, acceptance)
  assert.deepEqual(scope.acceptance, acceptance)
  assert.equal(scope.unknowns.includes('destination_address'), false)
})

test('walkthrough requires evidence and reports material discrepancies', () => {
  const base = {
    scopeVersionId: 'scope-v1',
    inventory: { materiallyMatches: true, expectedBoxes: 20, observedBoxes: 20, addedItems: [], removedItems: [], garageVerified: true, basementVerified: null, storageVerified: null },
    access: { stairsMatch: true, elevatorMatch: true, parkingMatch: true, carryDistanceMatch: true, restrictions: [] },
    handling: { undisclosedHeavyItems: [], unplannedDisassembly: [], missingEquipment: [] },
    capacity: { truckPlanAppropriate: true, visualAssessment: 'within_expected' as const },
    evidence: [],
  }
  assert.deepEqual(validateWalkthrough(base).errors, ['at least one arrival photo or video is required'])
  const result = validateWalkthrough({ ...base, inventory: { ...base.inventory, observedBoxes: 32 }, evidence: [{ url: 'https://example.test/photo.jpg', kind: 'image' }] })
  assert.equal(result.valid, true)
  assert.equal(result.outcome, 'discrepancy')
})
