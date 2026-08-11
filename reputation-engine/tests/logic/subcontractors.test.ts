import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSubcontractorOfferSms, evaluateSubcontractorEligibility } from '../../lib/subcontractors'

const contractor = {
  status: 'active' as const,
  branches: ['windsor'], serviceCities: ['Windsor'], serviceTags: ['moving'], truckSizes: ['26ft'],
  maxCrewSize: 4, insured: true, insuranceExpiresAt: '2027-01-01', completedJobs: 9, cancelledJobs: 1, averageRating: 4.8,
}

test('eligible contractor receives a high score', () => {
  const result = evaluateSubcontractorEligibility(contractor, { branch: 'windsor', originCity: 'windsor', crewSize: 3, truckSize: '26ft', serviceTags: ['moving'], moveDate: '2026-09-01' })
  assert.equal(result.eligible, true)
  assert.ok(result.score >= 90)
})

test('insurance and capacity are hard eligibility failures', () => {
  const result = evaluateSubcontractorEligibility({ ...contractor, insured: false, maxCrewSize: 2 }, { crewSize: 4 })
  assert.equal(result.eligible, false)
  assert.match(result.reasons.join(' '), /capacity/i)
  assert.match(result.reasons.join(' '), /insurance/i)
})

test('offer SMS omits customer address and name', () => {
  const sms = buildSubcontractorOfferSms({ companyName: 'ABC Moving', moveDate: '2026-09-01', originCity: 'Windsor', destinationCity: 'London', payout: 900, currency: 'CAD', url: 'https://example.test/o/1' })
  assert.match(sms, /CAD \$900\.00/)
  assert.doesNotMatch(sms, /customer/i)
})
