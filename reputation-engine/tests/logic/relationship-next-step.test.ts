import test from 'node:test'
import assert from 'node:assert/strict'
import { projectNextSteps, receiptDelivery, type EvidenceRow } from '../../lib/relationship-next-step'
import { chooseInterruptingNotification } from '../../lib/notification-attention'
const contact = { id: 'partner', name: 'Fixture', owner_name: 'Owner' }
const request = { id: 'request', contact_id: 'partner', direction: 'inbound', channel: 'sms', created_at: '2026-10-20T12:00:00Z', outcome_code: 'package_requested', notes: 'Please send a digital card.' }
function project(extra: { touches?: EvidenceRow[]; tasks?: EvidenceRow[]; logs?: EvidenceRow[]; contact?: EvidenceRow } = {}) {
  return projectNextSteps({ contact, touches: [request], tasks: [], logs: [], now: '2026-10-24T12:00:00Z', evidenceVersion: 'v1', ...extra })
}
test('an old request survives an unrelated later delivered reply and unrelated completed task', () => {
  const [step] = project({ touches: [request, { id: 'later', contact_id: 'partner', direction: 'outbound', channel: 'sms', created_at: '2026-10-24T12:00:00Z', notes: 'Thank you', metadata: { status: 'delivered' } }], tasks: [{ id: 'unrelated', related_id: 'partner', related_type: 'relationship', status: 'completed' }] })
  assert.equal(step.state, 'review'); assert.equal(step.taskId, null)
})
test('linked provider submission stays open, and a later delivery callback reconciles the same request', () => {
  const receipt = { id: 'receipt', contact_id: 'partner', direction: 'outbound', channel: 'sms', created_at: '2026-10-21T12:00:00Z', metadata: { status: 'sent' } }
  const logs = [{ id: 'link', contact_id: 'partner', action: 'next_step.receipt_linked', metadata: { insight_key: project()[0].key, receipt_touch_id: 'receipt' } }]
  assert.equal(project({ touches: [request, receipt], logs })[0].state, 'submitted')
  const delivered = project({ touches: [request, { ...receipt, metadata: { status: 'delivered' } }], logs })[0]
  assert.equal(delivered.state, 'fulfilled'); assert.equal(delivered.key, project()[0].key)
  assert.equal(project({ touches: [request, { ...receipt, metadata: { status: 'undelivered', twilioSid: 'SMfixture' } }], logs })[0].state, 'review')
})
test('provider failures override IDs; provider-queued messages stay submitted and calls cannot fulfil document requests', () => {
  for (const status of ['failed', 'bounced']) assert.equal(receiptDelivery({ id: 'r', direction: 'outbound', channel: 'email', metadata: { status, provider_message_id: 'provider' } }), null)
  assert.equal(receiptDelivery({ id: 'r', direction: 'outbound', channel: 'sms', metadata: { status: 'queued' } }), null)
  assert.equal(receiptDelivery({ id: 'r', direction: 'outbound', channel: 'sms', metadata: { status: 'queued', twilioSid: 'SMfixture' } }), 'submitted')
  assert.equal(receiptDelivery({ id: 'r', direction: 'outbound', channel: 'call', metadata: { status: 'delivered' } }), null)
})
test('future task timing wins over owner presence, and completed work is recorded without claiming delivery', () => {
  const task = { id: 'task', related_id: 'partner', related_type: 'relationship', source_key: project()[0].key, status: 'open', owner_name: 'Other rep', due_at: '2026-10-30T12:00:00Z' }
  const step = project({ tasks: [task] })[0]
  assert.equal(step.state, 'waiting'); assert.equal(step.owner, 'Other rep')
  assert.equal(project({ tasks: [{ ...task, status: 'completed' }] })[0].state, 'reviewed')
})
test('suppression overrides receipts; another contact or an earlier receipt cannot fulfil this request', () => {
  const receipt = { id: 'r', contact_id: 'other', direction: 'outbound', channel: 'sms', created_at: '2026-10-21T12:00:00Z', metadata: { status: 'delivered', relationship_fulfilment: { request_touch_id: 'request', kind: 'digital_card' } } }
  assert.equal(project({ touches: [request, receipt] })[0].state, 'review')
  assert.equal(project({ touches: [request, { ...receipt, contact_id: 'partner', created_at: '2026-10-19T12:00:00Z' }] })[0].state, 'review')
  assert.equal(project({ contact: { ...contact, cross_channel_suppressed_at: '2026-10-24' } })[0].state, 'suppressed')
})
test('physical cards cannot be fulfilled by a delivered text; email requires an email receipt', () => {
  for (const [outcome, kind] of [['postcard_requested', 'physical_card'], ['asks_for_email', 'email']]) {
    const touch = { ...request, outcome_code: outcome }, receipt = { id: 'r', contact_id: 'partner', direction: 'outbound', channel: 'sms', created_at: '2026-10-21T12:00:00Z', metadata: { status: 'delivered', relationship_fulfilment: { request_touch_id: 'request', kind } } }
    assert.equal(project({ touches: [touch, receipt] })[0].state, 'review')
  }
})
test('insurance request detection is a review candidate; reactions, automated replies and mentions do not become requests', () => {
  assert.equal(project({ touches: [{ ...request, outcome_code: null, notes: 'Could you please send your insurance certificate?' }] })[0].needsConfirmation, true)
  for (const touch of [{ ...request, metadata: { is_reaction: true } }, { ...request, metadata: { is_auto_reply: true } }, { ...request, outcome_code: null, notes: 'We already have insurance documents.' }]) assert.equal(project({ touches: [touch] }).length, 0)
})
test('corrections are scoped to the request; unchanged projections have stable identity', () => {
  const step = project()[0]
  assert.equal(project()[0].key, step.key)
  assert.equal(project({ logs: [{ id: 'log', contact_id: 'partner', action: 'next_step.corrected', metadata: { insight_key: step.key } }] })[0].state, 'reviewed')
})
test('existing reviewed fulfilment links are honored using the actual provider status', () => {
  const receipt = { id: 'receipt', contact_id: 'partner', direction: 'outbound', channel: 'sms', created_at: '2026-10-21T12:00:00Z', metadata: { status: 'delivered' } }
  assert.equal(project({ touches: [{ ...request, metadata: { partnership_review: { fulfilled_by_touch_id: receipt.id } } }, receipt] })[0].state, 'fulfilled')
})
test('routine activity cannot produce an interrupt; urgent selection is independent of input order', () => {
  const routine = { priority: 'today', time: '2026-10-24T12:00:00Z' }
  assert.equal(chooseInterruptingNotification([routine, { ...routine, priority: 'monitor' }]), undefined)
  const urgent = { priority: 'interrupt', time: '2026-10-23T12:00:00Z' }
  assert.equal(chooseInterruptingNotification([routine, urgent]), urgent)
})
