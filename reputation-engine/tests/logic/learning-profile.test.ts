import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLeadLearningProfile } from '../../lib/learning-profile'
import type { CRMLead } from '../../lib/types'

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return {
    id: 'lead-learning',
    name: 'Learning Test',
    stage: 'new',
    createdAt: '2026-07-25',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
    ...overrides,
  }
}

test('learning profile stores operational features without raw notes or addresses', () => {
  const profile = buildLeadLearningProfile(lead({
    originAddress: '123 Private Street',
    destAddress: '456 Private Avenue',
    notes: 'Private customer narrative',
    moveDate: '2026-08-10',
    propertyType: 'detached_house',
    source: 'customer_referral',
    referralCustomerName: 'Referrer',
    inventory: [{ name: 'Sofa', room: 'Living Room', qty: 1, cubicFeet: 70, weightLbs: 180, source: 'mls' }],
    totalCubicFeet: 70,
    totalWeightLbs: 180,
    jobFactors: { originParkingOk: true, destParkingOk: true },
  }))

  const serialized = JSON.stringify(profile)
  assert.equal(serialized.includes('123 Private Street'), false)
  assert.equal(serialized.includes('Private customer narrative'), false)
  assert.equal(profile.acquisition.referral_named, true)
  assert.equal(profile.confidence.ready_for_binding_price, true)
})

test('unknown dimensions lower binding-price confidence', () => {
  const profile = buildLeadLearningProfile(lead({
    moveDate: '2026-08-10',
    originAddress: 'Origin',
    destAddress: 'Destination',
    inventory: [{ name: 'Unusual sculpture', qty: 1, source: 'manual' }],
    originAccess: 'Driveway',
  }))

  assert.equal(profile.scope.unknown_dimension_count, 1)
  assert.equal(profile.confidence.ready_for_binding_price, false)
})
