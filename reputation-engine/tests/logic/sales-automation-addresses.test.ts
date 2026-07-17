import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAutomationMissingFields,
  hasCompleteMoveAddress,
  leadNeedsAccessBeforeAutomatedQuote,
} from '../../lib/sales-automation-qualification'
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
  assert.equal(hasCompleteMoveAddress('29 Alderton, Leamington, N8H 4L6'), true)
  assert.equal(hasCompleteMoveAddress('29 Alderton, Leamington'), false)
  assert.equal(hasCompleteMoveAddress('unit 901'), false)
  assert.equal(hasCompleteMoveAddress('unit 901, 962 Smyth Rd'), true)
  assert.equal(hasCompleteMoveAddress('601-203 Catherine St, Ottawa'), true)

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

test('automation blocks auto-quote for apartment-style addresses until access is known', () => {
  const base = lead({
    moveDate: '2026-08-22',
    originAddress: '601-203 Catherine St, Ottawa',
    originCity: 'Ottawa',
    destAddress: '456 Ouellette Ave, Windsor',
    destCity: 'Windsor',
    inventory: [{ name: 'Couch', qty: 1 }],
    email: 'customer@example.com',
  })

  assert.equal(leadNeedsAccessBeforeAutomatedQuote(base), true)
  assert.equal(leadNeedsAccessBeforeAutomatedQuote({ ...base, originAccess: 'Apartment elevator, loading zone in front' }), false)
  assert.equal(
    leadNeedsAccessBeforeAutomatedQuote({
      ...base,
      originAddress: '29 Alderton St, Leamington, N8H 4L6',
      propertyType: 'detached_house',
    }),
    false
  )
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
    inventory: [{ name: 'Sofa', qty: 1, source: 'mls' }],
  }))

  assert.equal(missing.includes('inventory_confirmation'), true)
  assert.equal(missing.includes('inventory'), false)
})

test('automation does not call customer-provided inventory an MLS scan', () => {
  const missing = getAutomationMissingFields(lead({
    moveDate: '2026-08-22',
    originAddress: '123 King St N',
    originCity: 'Waterloo',
    destAddress: '456 Ouellette Ave',
    destCity: 'Windsor',
    lastAutoEnrichmentAt: '2026-06-30T04:00:00.000Z',
    inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
  }))

  assert.equal(missing.includes('inventory_confirmation'), false)
  assert.equal(missing.includes('inventory'), false)
})
