import test from 'node:test'
import assert from 'node:assert/strict'
import { latestInboundCallbackNumber } from '../../lib/inbound-callback-number'
import type { CallLogEntry, InboundLead } from '../../lib/types'
const phone = '+14165550123'
const call = (branchNumber: string, direction: 'inbound' | 'outbound', date: string, caller = phone): CallLogEntry => ({ id: date, type: 'call', phone: caller, branchNumber, direction, date })
const inbound = (to: string, date: string): InboundLead => ({ id: date, source: 'twilio_call', phone, raw_data: { to, direction: 'inbound' }, created_at: date, claimed: false })
test('Ottawa inbound line wins over a newer Windsor outbound call', () => {
  assert.equal(latestInboundCallbackNumber({ phone, calls: [call('+16135193236', 'inbound', '2026-09-28'), call('+12267732993', 'outbound', '2026-09-29')] }), '+16135193236')
})
test('latest actual inbound call wins across call logs and unclaimed inbox records', () => {
  assert.equal(latestInboundCallbackNumber({ phone, calls: [call('+16135193236', 'inbound', '2026-09-28')], inbound: [inbound('+14377823004', '2026-09-29')] }), '+14377823004')
})
test('recognizes a caller before a CRM lead exists and normalizes SIP business numbers', () => {
  assert.equal(latestInboundCallbackNumber({ phone, inbound: [inbound('sip:+16135193236@voice.example.com', '2026-09-29')] }), '+16135193236')
})
test('unknown business lines, unrelated callers, SMS, and outbound records cannot pin a callback line', () => {
  assert.equal(latestInboundCallbackNumber({ phone, calls: [call('+12267732993', 'inbound', '2026-09-28', '+15195550999')], inbound: [inbound('+14165550111', '2026-09-29'), { ...inbound('+12267732993', '2026-09-29'), source: 'twilio_sms' }, { ...inbound('+12267732993', '2026-09-29'), raw_data: { to: '+12267732993', direction: 'outbound' } }] }), null)
})
