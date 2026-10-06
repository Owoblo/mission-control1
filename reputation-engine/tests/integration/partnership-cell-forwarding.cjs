const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function fixture({ blocked = false, unauthorized = false } = {}) {
  const captured = []
  const cache = new Map()
  const env = { PARTNERSHIP_FORWARD_PHONE_OTTAWA: '+13435513167', TELNYX_OUTBOUND_SIP_USERNAME: 'fixture', TELNYX_OUTBOUND_SIP_PASSWORD: 'fixture', TELNYX_TWILIO_SIP_DOMAIN_SID: 'SDfixture' }
  const stubs = {
    'lib/server/security.ts': { authorizeTwilioWebhook: async () => unauthorized ? new Response('', { status: 403 }) : null },
    'lib/server/interactions.ts': { captureTwilioInteraction: async (...args) => captured.push(args) },
    'lib/server/runtime.ts': { readEnv: key => env[key] || '', requireEnv: key => env[key], getAppBaseUrl: () => 'https://fixture.invalid', requireSupabaseEnv: () => ({ url: 'https://fixture.invalid', headers: {} }) },
    'lib/server/partnership-inbound.ts': { pausePartnershipSequenceForInbound: async () => ({ matched: false }) },
    'lib/server/dialer-settings.ts': { getDialerSettings: async () => ({}), findBlockedCaller: () => blocked },
    'lib/server/sales-repository.ts': {},
    'lib/server/sms-threads.ts': {},
    'lib/server/telephony-monitoring.ts': {},
    'lib/server/internal-notifications.ts': {},
  }
  function load(file) {
    file = path.normalize(file)
    if (file.endsWith('.json.ts')) return JSON.parse(fs.readFileSync(file.slice(0, -3), 'utf8'))
    if (stubs[file]) return stubs[file]
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    cache.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { exports, console, Request, Response, URL, URLSearchParams, process, fetch: async () => Response.json([{ id: 'ottawa-manager' }]), require: name => name.startsWith('@/') ? load(name.slice(2) + '.ts') : name.startsWith('.') ? load(path.join(path.dirname(file), name) + '.ts') : require(name) }, { filename: file })
    return exports
  }
  return { captured, load, async call(route, fields) {
    const response = await load(`app/api/${route}/dialer/twiml/route.ts`).POST(new Request('https://fixture.invalid/api/voice', { method: 'POST', body: new URLSearchParams(fields) }))
    return { status: response.status, xml: await response.text() }
  } }
}

const lines = ['+12268870667', '+12266055008', '+12262419853', '+15486391428', '+14374650584']
for (const route of ['sales', 'marketing']) for (const line of lines) {
  test(`${route}: ${line} forwards only to owner cell and retains business line`, async () => {
    const f = fixture()
    const { xml } = await f.call(route, { From: '+15555550123', To: line, Direction: 'inbound' })
    assert.match(xml, /<Dial /)
    assert.ok(xml.includes(`callerId="${line}"`))
    assert.match(xml, /12267241730/)
    assert.doesNotMatch(xml, /<Client/)
    assert.ok(xml.includes(`line=${encodeURIComponent(line)}`))
    assert.equal(f.captured.length, 1)
    assert.equal(f.captured[0][1], 'partnership_call')
    if (line === '+14374650584') assert.match(xml, /sip:\+12267241730@sip.telnyx.com/)
  })
}
test('Ottawa retains manager clients and Ottawa configured phone', async () => {
  const f = fixture()
  assert.equal(f.load('lib/partnership-call-forwarding.ts').partnershipCellForwardTarget('+15482908695'), null)
  const { xml } = await f.call('marketing', { From: '+15555550123', To: '+15482908695' })
  assert.match(xml, /partnership-rep-ottawa-manager/)
  assert.match(xml, /13435513167/)
  assert.doesNotMatch(xml, /12267241730/)
})
test('authenticated Telnyx SIP ingress forwards as inbound', async () => {
  const { xml } = await fixture().call('sales', { From: 'sip:+15555550123@example.invalid', To: 'sip:+14374650584@example.invalid', SipDomainSid: 'SDfixture' })
  assert.match(xml, /sip:\+12267241730@sip.telnyx.com/)
  assert.doesNotMatch(xml, /<Client/)
})
for (const line of [...lines, '+15482908695']) test(`callback retains selected ${line}`, async () => {
  const { xml } = await fixture().call('sales', { From: 'client:saturn-rep-owner', To: '+15555550123', preferredFromNumber: line, Direction: 'inbound' })
  assert.ok(xml.includes(`callerId="${line}"`))
  assert.match(xml, /15555550123/)
  assert.doesNotMatch(xml, /12267241730/)
})
test('blocked caller and unsigned webhook cannot reach forwarding', async () => {
  const fields = { From: '+15555550123', To: lines[0], Direction: 'inbound' }
  assert.match((await fixture({ blocked: true }).call('sales', fields)).xml, /<Reject/)
  assert.equal((await fixture({ unauthorized: true }).call('sales', fields)).status, 403)
})
