import assert from 'node:assert/strict'
import test from 'node:test'
import {
  automatedEstimateSendingIsPaused,
  getAutomationMissingFields,
  getFastLaneReadinessIssues,
  getFastLaneBlockingIssues,
  getFastLaneTruckSize,
  hasConfirmedAutomatedEstimateScope,
  hasCompleteMoveAddress,
  isEstimateScopeConfirmation,
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

test('fast lane blocks malformed and incomplete intake even when a rep tries to send', () => {
  const issues = getFastLaneReadinessIssues(lead({
    moveDate: '2023-10-13',
    moveType: 'labor-only',
    originAddress: '2-12 high st',
    originCity: 'Waterloo',
    destAddress: '2-12 high st, Waterloo ontario n2l3x6 July 22',
    inventory: [],
  }), new Date('2026-07-21T12:00:00'))

  assert.equal(issues.includes('move_date'), true)
  assert.equal(issues.includes('destination_address'), true)
  assert.equal(issues.includes('destination_city'), true)
  assert.equal(issues.includes('inventory'), true)
  assert.equal(issues.includes('access'), true)
})

test('fast lane unlocks only for a current, fully scoped move', () => {
  const issues = getFastLaneReadinessIssues(lead({
    moveDate: '2026-07-24',
    moveType: 'labor-only',
    originAddress: '12 High St',
    originCity: 'Waterloo',
    destAddress: '88 King St W',
    destCity: 'Kitchener',
    inventory: [{ name: 'Sofa', qty: 1, source: 'customer_verification' }],
    originAccess: 'Ground floor; curb parking confirmed',
  }), new Date('2026-07-21T12:00:00'))

  assert.deepEqual(issues, [])
})

test('labour-only hourly booking can proceed with a date and work location', () => {
  const candidate = lead({
    moveDate: '2026-07-24',
    moveType: 'labor-only',
    originAddress: '12 High St',
    originCity: 'Waterloo',
    inventory: [],
  })

  const readiness = getFastLaneReadinessIssues(candidate, new Date('2026-07-21T12:00:00'))
  const blocking = getFastLaneBlockingIssues(candidate, 'labor', new Date('2026-07-21T12:00:00'))

  assert.equal(readiness.includes('inventory'), true)
  assert.equal(readiness.includes('access'), true)
  assert.deepEqual(blocking, [])
})

test('hourly truck booking also proceeds while remaining scope is confirmed before dispatch', () => {
  const candidate = lead({
    moveDate: '2026-07-24',
    originAddress: '12 High St',
    originCity: 'Waterloo',
    inventory: [],
  })

  const blocking = getFastLaneBlockingIssues(candidate, 'truck', new Date('2026-07-21T12:00:00'))
  assert.deepEqual(blocking, [])
})

test('fast lane truck size follows the selected crew size', () => {
  assert.equal(getFastLaneTruckSize(2), '15ft')
  assert.equal(getFastLaneTruckSize(3), '20ft')
  assert.equal(getFastLaneTruckSize(4), '26ft')
})

test('automated pricing requires an explicit confirmed-scope threshold', () => {
  assert.equal(automatedEstimateSendingIsPaused(), true)
  assert.equal(hasConfirmedAutomatedEstimateScope(lead({ qualificationState: { lastIntent: 'awaiting_estimate_scope_confirmation' } })), false)
  assert.equal(hasConfirmedAutomatedEstimateScope(lead({ qualificationState: { lastIntent: 'estimate_scope_confirmed' } })), true)
  assert.equal(isEstimateScopeConfirmation('96 Scott Road to 456 Lorne Ave'), false)
  assert.equal(isEstimateScopeConfirmation('Yes, those details are correct. Send the estimate.'), true)
  assert.equal(isEstimateScopeConfirmation('The destination unit is 201'), false)
})
