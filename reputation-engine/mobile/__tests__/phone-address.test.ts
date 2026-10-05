import { customerPhoneForCall, phoneFromVoiceAddress } from '../src/phone-address';

test('extracts Toronto carrier callers without digits from the SIP hostname', () => {
  expect(phoneFromVoiceAddress('sip:+14377823004@saturn-gta-76ee90d5.sip.twilio.com;transport=tls')).toBe('+14377823004');
  expect(phoneFromVoiceAddress('sip:%2B14374650584@sip.telnyx.com')).toBe('+14374650584');
  expect(phoneFromVoiceAddress('client:saturn-rep-1234567890')).toBe('');
  expect(phoneFromVoiceAddress('sip:%ZZ@sip.telnyx.com')).toBe('');
});

test('outbound history uses the customer, not our selected caller ID', () => {
  expect(customerPhoneForCall('outbound', '+14377823004', 'sip:+12265550123@sip.telnyx.com', '+12265550123')).toBe('+12265550123');
  expect(customerPhoneForCall('inbound', 'sip:+12265550123@sip.telnyx.com', 'client:saturn-rep-owner')).toBe('+12265550123');
});
