import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canSeeAllPartnershipMarkets,
  isPartnershipManager,
  partnershipMarketKeysForSession,
  partnershipRecordMatchesSession,
} from '../../lib/server/partnership-access'
import type { SessionPayload } from '../../lib/auth'

const courage: SessionPayload = {
  exp: Date.now() + 60_000,
  userId: 'courage-user',
  name: 'Dr Courage',
  role: 'manager',
  branch: 'ottawa',
}

test('branch manager sees their market rather than the company-wide partnership database', () => {
  assert.equal(canSeeAllPartnershipMarkets(courage), false)
  assert.equal(isPartnershipManager(courage), true)
  assert.ok(partnershipMarketKeysForSession(courage).includes('ottawa'))
  assert.equal(partnershipRecordMatchesSession(courage, { city: 'Ottawa' }), true)
  assert.equal(partnershipRecordMatchesSession(courage, { city: 'Windsor' }), false)
})

test('branch manager retains records explicitly assigned to them outside the literal city list', () => {
  assert.equal(partnershipRecordMatchesSession(courage, {
    city: 'Rockland',
    assigned_manager_user_id: 'courage-user',
  }), true)
  assert.equal(partnershipRecordMatchesSession(courage, {
    city: 'Rockland',
    owner_name: 'Dr Courage',
  }), true)
})

test('owner and unscoped central manager retain company-wide partnership access', () => {
  assert.equal(canSeeAllPartnershipMarkets({ exp: courage.exp, role: 'owner' }), true)
  assert.equal(canSeeAllPartnershipMarkets({ exp: courage.exp, role: 'manager' }), true)
})
