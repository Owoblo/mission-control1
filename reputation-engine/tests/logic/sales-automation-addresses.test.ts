import assert from 'node:assert/strict'
import test from 'node:test'
import { getAutomationMissingFields, hasCompleteMoveAddress } from '../../lib/sales-automation-qualification'
import type { CRMLead } from '../../lib/types'

function lead(overrides: Partial<CRMLead>): CRMLead {
  return {
    id: 'lead_address_test',
    name: 'Address Test',
    stage: 'new',
    createdAt: '2026-06-30',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
    ...overrides,
  }
}

test('automation treats city-only route details as missing exact addresses', () => {
  const missing = getAutomationMissingFields(lead({
    moveDate: '2026-08-22',
    originCity: 'Waterloo',
    destCity: 'Windsor',
  }))

  assert.deepEqual(missing.slice(0, 2), ['origin_address', 'destination_address'])
  assert.equal(missing.includes('origin'), false)
  assert.equal(missing.includes('destination'), false)
})

test('automation accepts street-level pickup and dropoff addresses', () => {
  assert.equal(hasCompleteMoveAddress('123 King St N, Waterloo, ON'), true)
  assert.equal(hasCompleteMoveAddress('Waterloo'), false)

  const missing = getAutomationMissingFields(lead({
    moveDate: '2026-08-22',
    originAddress: '123 King St N',
    originCity: 'Waterloo',
    destAddress: '456 Ouellette Ave',
    destCity: 'Windsor',
    inventory: [{ name: 'Couch', qty: 1 }],
    originAccess: 'Elevator',
  }))

  assert.equal(missing.includes('origin_address'), false)
  assert.equal(missing.includes('destination_address'), false)
})

test('automation requires confirmation before treating MLS inventory as ready', () => {
  const missing = getAutomationMissingFields(lead({
    moveDate: '2026-08-22',
    originAddress: '123 King St N',
    originCity: 'Waterloo',
    destAddress: '456 Ouellette Ave',
    destCity: 'Windsor',
    listingScanSnapshot: {
      inventory: [{ name: 'Sofa', qty: 1 }],
      totalItems: 1,
      totalCubicFeet: 80,
      source: 'mls_photo_ai',
    },
    lastAutoEnrichmentAt: '2026-06-30T04:00:00.000Z',
    inventory: [{ name: 'Sofa', qty: 1 }],
  }))

  assert.equal(missing.includes('inventory_confirmation'), true)
  assert.equal(missing.includes('inventory'), false)
})
