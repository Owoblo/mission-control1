import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCurrentHandoffTouches, canCreatePartnerHandoff } from '../../lib/server/partnership-handoff-policy'
import { detectPartnershipLeadSignal } from '../../lib/server/partnership-lead-detection'
import { extractPartnershipReferralDetails } from '../../lib/server/partnership-referral-details'
const now = new Date('2026-09-23T20:00:00Z')
const touch = { id: '1', contact_id: 'partner', created_at: '2026-09-23T19:00:00Z', notes: 'My client needs movers next week. Can you quote it?' }
test('explicit correction prevents resurrection of an older request', () => {
  assert.equal(selectCurrentHandoffTouches([touch, {...touch, id: '2', created_at: '2026-09-23T19:30:00Z', notes: 'Wrong service, I was asking about photography.'}], now).size, 0)
})
test('routine later updates do not erase a current request', () => {
  const later = {...touch, id: '2', created_at: '2026-09-23T19:30:00Z', notes: 'He will confirm tomorrow.'}
  assert.equal(selectCurrentHandoffTouches([touch, later], now).get('partner')?.id, '1')
})
test('natural-language price request creates a handoff even without the words client or quote', () => {
  const request = 'John my Grandson only have 2 Queen mattress few dressers moving within 19 Mins drive from basement apartment. How much would cost him?'
  assert.equal(detectPartnershipLeadSignal(request).is_lead, true)
  assert.equal(selectCurrentHandoffTouches([{...touch, notes: request}], now).size, 1)
})
test('ambiguous customer names remain unconfirmed while phone ownership is checked', () => {
  assert.deepEqual(extractPartnershipReferralDetails([
    'Inbound SMS: John my Grandson needs a small move.',
    'Inbound SMS: Robert said he will confirm with you tomorrow his cell phone is 4374394910 thanks',
  ], '+14162301083'), {
    customerName: undefined,
    customerPhone: '+14374394910',
    phoneOwnershipNote: 'Partner says the referred person will confirm; verify whose number this is before calling.',
  })
})
test('fresh affirmative need is eligible but old history is not a new assignment', () => {
  assert.equal(selectCurrentHandoffTouches([touch], now).size, 1)
  assert.equal(selectCurrentHandoffTouches([{...touch, created_at:'2026-08-01T00:00:00Z'}], now).size, 0)
})
test('existing, archived and human managed handoffs are never reset', () => {
  assert.equal(canCreatePartnerHandoff({}, true), false)
  assert.equal(canCreatePartnerHandoff({}, false), true)
})
test('suppressed and declined partners are not handed to sales for contact', () => {
  for(const contact of [{do_not_contact:true}, {decision:'opted_out'}, {stage:'lost'}, {decision:'not_interested'}]) assert.equal(canCreatePartnerHandoff(contact, false),false)
})

test('an explicit referred name wins over a greeting addressee', () => {
  const details = extractPartnershipReferralDetails(['Hi John my grandson Robert needs movers next week. His name is Robert.'])
  assert.equal(details.customerName, 'Robert')
})
