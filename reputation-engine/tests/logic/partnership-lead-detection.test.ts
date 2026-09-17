import test from 'node:test'
import assert from 'node:assert/strict'
import { detectPartnershipLeadSignal } from '../../lib/server/partnership-lead-detection'

test('detects a client move as a high priority sales lead', () => {
  const result = detectPartnershipLeadSignal('I have a client who needs movers after closing next week. Can you quote it?')
  assert.equal(result.is_lead, true)
  assert.equal(result.kind, 'quote_request')
  assert.equal(result.priority, 'urgent')
})

test('detects recurring staging work as a lead', () => {
  const result = detectPartnershipLeadSignal('We have a staging job coming up and need help with furniture delivery and installation.')
  assert.equal(result.is_lead, true)
  assert.equal(result.kind, 'direct_job')
})

test('does not promote a generic partnership acknowledgement', () => {
  const result = detectPartnershipLeadSignal('Sounds good, I will keep you in mind.')
  assert.equal(result.is_lead, false)
})
