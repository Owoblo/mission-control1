import test from 'node:test'
import assert from 'node:assert/strict'
import { autonomyEligibility, planRelationshipActions, referralOutcomes, relationshipMomentum, relationshipTasks, resolveNamedReferrer } from '../../lib/relationship-development'

const c = { id: 'c1', name: 'Sarah Jones', company: 'North Homes', city: 'Windsor', owner_name: 'John' }
const inbound = { id: 't1', contact_id: 'c1', direction: 'inbound', outcome_code: 'asks_for_email', created_at: '2026-09-01T00:00:00Z', notes: 'Please email details' }
test('request action is idempotent and does not claim fulfilment from unrelated outbound', () => {
  const action = planRelationshipActions({ contact: { ...c, owner_name: null }, touches: [inbound, { id: 't2', contact_id: 'c1', direction: 'outbound', channel: 'sms', created_at: '2026-09-02T00:00:00Z', metadata: { twilioSid: 'SMx' } }], tasks: [], referrals: [], now: '2026-09-03T00:00:00Z' })
  assert.equal(action[0].kind, 'email')
  assert.equal(action[0].disposition, 'review')
  assert.equal(relationshipTasks(action, [c], '2026-09-03T00:00:00Z')[0].sourceKey, action[0].key)
  assert.equal(planRelationshipActions({ contact: c, touches: [inbound], tasks: [{ id: action[0].key, source_key: action[0].key, related_id: 'c1', related_type: 'relationship', status: 'completed', title: action[0].title }], referrals: [], now: '2026-09-03T00:00:00Z' })[0].disposition, 'fulfilled')
})
test('named referrer produces candidates but always requires confirmation', () => {
  const result = resolveNamedReferrer({ name: 'Sarah', company: 'North Homes', city: 'Windsor' }, [c, { id: 'c2', name: 'Sarah Jones', company: 'South Homes', city: 'Windsor' }])
  assert.equal(result.requiresConfirmation, true)
  assert.equal(result.candidates[0].contactId, 'c1')
})
test('signal is review-only and suppression prevents it becoming a touch', () => {
  const rows = planRelationshipActions({ contact: { ...c, do_not_contact: true }, touches: [], tasks: [], referrals: [], signals: [{ id: 's1', source: 'listing', kind: 'listing', occurred_at: '2026-09-02T00:00:00Z', relevant: true, contact_id: 'c1' }], now: '2026-09-03T00:00:00Z' })
  assert.equal(rows[0].disposition, 'graph_only')
})
test('momentum exposes explainable components, not an opaque score', () => {
  const result = relationshipMomentum({ touches: [inbound], tasks: [], referrals: [], appointments: [], now: '2026-09-03T00:00:00Z' })
  assert.ok(result.components.some(c => c.name === 'recent_inbound'))
  assert.equal(result.purpose, 'human_attention_only')
})
test('outcomes keep unobserved recognition and margin unknown', () => {
  const rows = referralOutcomes([{ id: 'r', contact_id: 'c1', crm_lead_id: 'l', job_status: 'completed', booked_amount_cents: 1000 }], [{ id: 'l', data: { stage: 'completed', quoteId: 'q' } }], [{ id: 'q', data: { total: 10, paymentRecords: [{ id: 'p', amount: 10, status: 'captured' }] } }], [])
  assert.equal(rows[0].recognizedRevenueCents, null)
  assert.equal(rows[0].actualGrossProfitCents, null)
})
test('autonomy promotion remains explicit even after a large clean sample', () => {
  assert.equal(autonomyEligibility({ action: 'send_requested_card', reviewed: 1000, failures: 0, complaints: 0, corrections: 0, policyVersion: 'relationship-development-v1' }).automaticPromotion, false)
})
