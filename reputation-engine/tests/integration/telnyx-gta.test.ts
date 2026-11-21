import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { authorizeTelnyxWebhook } from '../../lib/server/telnyx-security'
import { carrierDialTarget, carrierVoiceForm } from '../../lib/server/carrier-voice'
import { sendSmsProviderRequest } from '../../lib/server/sms-provider'
import { GTA_SALES_NUMBER, GTA_PARTNERSHIP_NUMBER, isSmsProviderReceipt } from '../../lib/telephony-providers'
import { getSalesBranchFromSaturnPhone, inferSaturnBranchPhoneNumberFromCity, normalizePhone } from '../../lib/sales-phones'
import { getPartnershipPrimaryNumberForMarket } from '../../lib/partnership-lines'
import { isInternalVoiceAddress, resolveTwilioCallLegs } from '../../lib/twilio-call-control'

test('GTA city and number routing keeps sales and partnerships distinct', () => {
  for (const city of ['Toronto', 'Mississauga', 'Scarborough', 'Richmond Hill', 'North York']) {
    assert.equal(inferSaturnBranchPhoneNumberFromCity(city), GTA_SALES_NUMBER)
    assert.equal(getPartnershipPrimaryNumberForMarket(city), GTA_PARTNERSHIP_NUMBER)
  }
  assert.equal(getSalesBranchFromSaturnPhone(GTA_SALES_NUMBER), 'toronto')
  assert.equal(getPartnershipPrimaryNumberForMarket('Windsor'), '+12268870667')
})

test('Telnyx webhook rejects modified bodies, old timestamps and wrong signatures', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const body = '{"data":{"id":"event"}}'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64')
  const request = new Request('https://crm.test/hook', { headers: { 'telnyx-timestamp': timestamp, 'telnyx-signature-ed25519': signature } })
  assert.equal(authorizeTelnyxWebhook(request, body), null)
  assert.equal(authorizeTelnyxWebhook(request, body + ' ')?.status, 401)
  assert.equal(authorizeTelnyxWebhook(new Request('https://crm.test/hook'), body)?.status, 401)
  assert.equal(authorizeTelnyxWebhook(new Request('https://crm.test/hook', { headers: { 'telnyx-timestamp': '1', 'telnyx-signature-ed25519': signature } }), body)?.status, 401)
})

test('only the authenticated carrier domain can normalize inbound SIP into a customer call', () => {
  process.env.TELNYX_TWILIO_SIP_DOMAIN_SID = 'SDgta'
  const form = new URLSearchParams({ From: 'sip:+14165550100@carrier.example', To: `sip:${GTA_SALES_NUMBER}@saturn-gta.sip.twilio.com`, SipDomainSid: 'SDgta' })
  assert.equal(carrierVoiceForm(form.toString()).get('From'), '+14165550100')
  assert.equal(carrierVoiceForm(form.toString()).get('To'), GTA_SALES_NUMBER)
  form.set('SipDomainSid', 'SDstaff')
  assert.equal(carrierVoiceForm(form.toString()).get('Carrier'), null)
  assert.equal(normalizePhone('sip:+14165550100@sip1.carrier2.example'), '+14165550100')
})

test('Toronto outbound calls use authenticated Telnyx SIP and existing calls keep PSTN routing', () => {
  process.env.TELNYX_OUTBOUND_SIP_USERNAME = 'testuser'
  process.env.TELNYX_OUTBOUND_SIP_PASSWORD = 'secret<&'
  assert.match(carrierDialTarget('+14165550100', GTA_SALES_NUMBER), /sip:\+14165550100@sip.telnyx.com;transport=tls/)
  assert.match(carrierDialTarget('+14165550100', GTA_PARTNERSHIP_NUMBER), /secret&lt;&amp;/)
  assert.equal(carrierDialTarget('+14165550100', '+12267732993'), '<Number>+14165550100</Number>')
  assert.throws(() => carrierDialTarget('+441234567890', GTA_SALES_NUMBER))
})

test('SIP carrier customer legs remain identifiable for hold and transfer', () => {
  assert.equal(isInternalVoiceAddress('sip:+14165550100@sip.telnyx.com'), false)
  assert.equal(isInternalVoiceAddress('sip:john@saturn.sip.twilio.com'), true)
  const root = 'CA' + '1'.repeat(32), child = 'CA' + '2'.repeat(32)
  const resolved = resolveTwilioCallLegs({ sid: root, from: 'client:rep' }, [{ sid: child, parent_call_sid: root, from: GTA_SALES_NUMBER, to: 'sip:+14165550100@sip.telnyx.com', status: 'in-progress' }])
  assert.equal(resolved.customerCallSid, child)
})

test('SMS/MMS adapter uses Telnyx for GTA, preserves media and normalizes its receipt', async () => {
  process.env.TELNYX_API_KEY = 'test-key'
  process.env.NEXT_PUBLIC_APP_URL = 'https://crm.test'
  const id = '11111111-2222-3333-4444-555555555555'
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://api.telnyx.com/v2/messages')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.from, GTA_PARTNERSHIP_NUMBER)
    assert.deepEqual(body.media_urls, ['https://media.test/photo.jpg'])
    assert.equal(body.webhook_url, 'https://crm.test/api/sales/telnyx/messaging')
    return Response.json({ data: { id, to: [{ status: 'queued' }] } })
  }) as typeof fetch
  const response = await sendSmsProviderRequest('https://api.twilio.com/unused', { method: 'POST', body: new URLSearchParams({ From: GTA_PARTNERSHIP_NUMBER, To: '+14165550100', Body: 'Hello', MediaUrl: 'https://media.test/photo.jpg' }) }, fake)
  const receipt = await response.json()
  assert.equal(receipt.sid, `telnyx:${id}`)
  assert.equal(isSmsProviderReceipt(receipt.sid), true)
})

test('ambiguous provider acceptance never retries or switches carriers', async () => {
  let calls = 0
  const fake = (async () => { calls++; return Response.json({ data: {} }) }) as typeof fetch
  await assert.rejects(sendSmsProviderRequest('https://api.twilio.com/unused', { method: 'POST', body: new URLSearchParams({ From: GTA_SALES_NUMBER, To: '+14165550100', Body: 'Hello' }) }, fake), /Ambiguous/)
  assert.equal(calls, 1)
})

test('existing Twilio sends retain their complete request', async () => {
  const init = { method: 'POST', body: new URLSearchParams({ From: '+12267732993', To: '+15195550100', Body: 'Hello' }) }
  const fake = (async (url: string | URL | Request, actual?: RequestInit) => {
    assert.equal(url, 'https://api.twilio.com/messages'); assert.equal(actual, init)
    return Response.json({ sid: 'SM' + 'a'.repeat(32) })
  }) as typeof fetch
  assert.equal((await sendSmsProviderRequest('https://api.twilio.com/messages', init, fake)).status, 200)
})
