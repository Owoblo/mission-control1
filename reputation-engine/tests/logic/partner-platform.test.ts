import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePartnerScore, deriveComplianceState, detectAssignmentConflicts, tierForScore } from '../../lib/partner-platform'

test('compliance detects missing, warning, and expired records', () => {
  const now = new Date('2026-08-11T12:00:00Z')
  assert.equal(deriveComplianceState({ required: true }, now), 'missing')
  assert.equal(deriveComplianceState({ required: true, status: 'verified', expiresAt: '2026-09-01' }, now), 'warning')
  assert.equal(deriveComplianceState({ required: true, status: 'verified', expiresAt: '2026-08-01' }, now), 'expired')
})

test('conflicts only report shared resources in overlapping live assignments', () => {
  const conflicts = detectAssignmentConflicts({ startsAt: '2026-08-11T12:00:00Z', endsAt: '2026-08-11T16:00:00Z', memberIds: ['m1'], vehicleIds: ['v1'], assignments: [{ id: 'a1', startsAt: '2026-08-11T15:00:00Z', endsAt: '2026-08-11T18:00:00Z', memberIds: ['m1'], vehicleIds: ['v2'], status: 'confirmed' }] })
  assert.deepEqual(conflicts, [{ assignmentId: 'a1', resourceType: 'member', resourceId: 'm1' }])
})

test('performance score and tier remain deterministic', () => {
  const score = calculatePartnerScore({ onTimeRate: .98, acceptanceRate: .9, cancellationRate: .01, customerRating: 4.9, claimsRate: .01, communicationRate: .96, complianceRate: 1 })
  assert.ok(score >= 93)
  assert.equal(tierForScore(score), 'premier')
})
