import test from 'node:test'
import assert from 'node:assert/strict'
import { currentVerification, lostTransitionError, verificationScope, verificationSummary, type LeadVerification } from '../../lib/lead-verification'
import type { CRMLead } from '../../lib/types'
const lead = (overrides: Partial<CRMLead> = {}): CRMLead => ({ id: 'test', name: 'Customer', stage: 'quoted', createdAt: '2026-09-28', originAddress: '1 Main St', destAddress: '2 King St', ...overrides })
function verified(value: CRMLead, overrides: Partial<LeadVerification> = {}): CRMLead {
  return { ...value, verificationHistory: [{ id: 'v1', key: 'origin', status: 'verified', method: 'call', note: 'Customer confirms short driveway carry.', scope: verificationScope(value, 'origin'), recordedAt: '2026-09-28T12:00:00Z', actorName: 'Rep', ...overrides }] }
}
test('recorded verification survives unrelated changes but reopens when access changes', () => {
  const value = verified(lead())
  assert.equal(verificationSummary(value).verified, 1)
  assert.equal(currentVerification({ ...value, followUpNote: 'Call Monday' }, 'origin').stale, false)
  assert.equal(currentVerification({ ...value, originAddress: '99 New St' }, 'origin').stale, true)
  assert.equal(verificationSummary({ ...value, jobFactors: { originFloors: 3 } }).verified, 0)
})
test('contacted and follow-up entries do not pretend verification is complete', () => {
  assert.equal(verificationSummary(verified(lead(), { status: 'contacted' })).verified, 0)
  assert.equal(verificationSummary(verified(lead(), { status: 'needs_follow_up' })).followUp, 1)
})
test('latest decision wins while earlier evidence remains in history', () => {
  const value = verified(lead())
  value.verificationHistory!.push({ ...value.verificationHistory![0], id: 'v2', status: 'needs_follow_up', note: 'Customer now reports stairs.' })
  assert.equal(currentVerification(value, 'origin').entry?.id, 'v2')
  assert.equal(value.verificationHistory!.length, 2)
  assert.equal(verificationSummary(value).verified, 0)
})
test('Lost requires evidence; silence and timing cannot close a lead', () => {
  const value = lead()
  assert.ok(lostTransitionError(value, { ...value, stage: 'lost' }))
  for (const lostReason of ['timing', 'no_response']) assert.ok(lostTransitionError(value, { ...value, stage: 'lost', lostReason, lostNotes: 'Waiting on the house sale.' }))
  assert.ok(lostTransitionError(value, { ...value, stage: 'lost', lostReason: 'competitor' }))
  assert.equal(lostTransitionError(value, { ...value, stage: 'lost', lostReason: 'competitor', lostNotes: 'Customer SMS on Sep 28 confirms booking another mover.' }), null)
  assert.equal(lostTransitionError(value, { ...value, stage: 'nurture' }), null)
})
test('unrelated edits to legacy lost leads are still possible', () => {
  const value = lead({ stage: 'lost' })
  assert.equal(lostTransitionError(value, { ...value, name: 'Corrected name' }), null)
})
test('inventory, destination and timing have separate verification scopes', () => {
  const value = lead()
  assert.notEqual(verificationScope(value, 'timing'), verificationScope({ ...value, moveDateFlexible: true }, 'timing'))
  assert.notEqual(verificationScope(value, 'destination'), verificationScope({ ...value, destAccess: 'Two flights' }, 'destination'))
  assert.notEqual(verificationScope(value, 'inventory'), verificationScope({ ...value, inventory: [{name:'Sofa'}] }, 'inventory'))
  assert.equal(verificationScope(value, 'origin'), verificationScope({ ...value, inventory: [{name:'Sofa'}] }, 'origin'))
})
