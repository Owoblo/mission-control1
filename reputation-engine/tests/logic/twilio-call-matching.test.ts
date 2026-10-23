import test from 'node:test'
import assert from 'node:assert/strict'
import { groupTwilioCallsByPhone, twilioPhoneFilters } from '../../lib/twilio-call-matching'

test('Twilio call lookup covers E.164 and Telnyx SIP forms in both directions', () => {
  const filters = twilioPhoneFilters('416-677-2787')
  assert.equal(filters.length, 6)
  assert.ok(filters.some(filter => filter.field === 'From' && filter.value === 'sip:+14166772787@sip.telnyx.com'))
  assert.ok(filters.some(filter => filter.field === 'To' && filter.value === 'sip:+14166772787@sip.telnyx.com;transport=tls'))
})

test('inbound parent and rep legs become one customer timeline call', () => {
  const calls = [
    { sid: 'CAroot', from: 'sip:+14166772787@sip.telnyx.com', to: 'sip:+14377823004@saturn-gta.sip.twilio.com', start_time: '2026-10-09T20:40:22Z' },
    { sid: 'CArep', parent_call_sid: 'CAroot', from: 'sip:+14166772787@sip.telnyx.com', to: 'client:saturn-rep-1', start_time: '2026-10-09T20:40:27Z' },
  ]
  const grouped = groupTwilioCallsByPhone(calls, '+14166772787')
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].call.sid, 'CAroot')
  assert.deepEqual(grouped[0].callSids.sort(), ['CArep', 'CAroot'])
})

test('outbound SIP customer leg is retained and can resolve its parent recording', () => {
  const calls = [
    { sid: 'CAoutbound-customer', parent_call_sid: 'CAbrowser', from: '+14377823004', to: 'sip:+14166772787@sip.telnyx.com;transport=tls', start_time: '2026-10-09T19:48:14Z', direction: 'outbound-dial' },
  ]
  const grouped = groupTwilioCallsByPhone(calls, '+1 (416) 677-2787')
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].call.sid, 'CAoutbound-customer')
  assert.deepEqual(grouped[0].callSids.sort(), ['CAbrowser', 'CAoutbound-customer'])
})
