import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url), createLoader = require('../helpers/load-typescript.cjs'), root = path.resolve('.')
const caller = '+14165550199', line = '+14374650584', sid = 'CA' + 'a'.repeat(32)
const { partnershipInboundNotificationEmail } = createLoader(root, {
  '@/lib/server/runtime': { readEnv: () => '' }, '@/lib/server/sms-provider': {},
  './email-sms-reply-store': {}, '@/lib/partnership-core/ottawa.mjs': {}, '@/lib/server/email-provider': {},
})(path.join(root, 'lib/server/internal-notifications.ts'))
function fixture({ contacts = [], contractors = [], lookupFailed = false, contractorLookupFailed = false, fallback = false, approvedSip = true } = {}) {
  const original = globalThis.fetch, alerts = new Map(), touches = new Map(), receipts = [], tasks = [], markets = [], writes = [], reads = []
  let alertFailure = false
  globalThis.fetch = async (endpoint, options = {}) => {
    const u = new URL(endpoint), table = u.pathname.split('/').at(-1)
    assert.equal(u.hostname, 'database.fixture', 'No email or phone provider may be contacted by this test')
    if (options.method) writes.push(table)
    else reads.push(table)
    if (table === 'enqueue_internal_alert') {
      if (alertFailure) return Response.json({ error: 'Fixture outbox unavailable' }, { status: 503 })
      const body = JSON.parse(options.body)
      if (!alerts.has(body.p_event)) alerts.set(body.p_event, body.p_payload)
      return Response.json(null)
    }
    if (table === 'market_contacts') return lookupFailed && !options.method ? Response.json({}, { status: 503 }) : Response.json(contacts)
    if (table === 'subcontractors') return contractorLookupFailed ? Response.json({}, { status: 503 }) : Response.json(contractors)
    if (table === 'market_touches') { const body = JSON.parse(options.body); if (!touches.has(body.id)) touches.set(body.id, body); return Response.json([]) }
    throw Error(`Unexpected storage path ${u.pathname}`)
  }
  const runtime = { requireSupabaseEnv: () => ({ url: 'https://database.fixture', headers: {} }), readEnv: key => key === 'TWILIO_AUTH_TOKEN' ? 'fixture-secret' : approvedSip && key === 'TELNYX_TWILIO_SIP_DOMAIN_SID' ? 'SDfixture' : '' }
  const load = createLoader(root, {
    '@/lib/server/runtime': runtime, './runtime': runtime,
    '@/lib/server/interactions': { captureTwilioInteraction: async (raw, source) => { receipts.push({ raw, source }); return 'receipt' } },
    '@/lib/server/partner-call-fallback': { partnershipSalesFallbackXml: async () => fallback ? '<Response><Dial><Client>fixture-rep</Client></Dial></Response>' : null },
    '@/lib/server/partner-sales-handoff': { queueMissedPartnershipCall: async (...args) => tasks.push(args) },
    '@/lib/server/partnership-inbound': { pausePartnershipSequenceForInbound: async () => {} },
    './internal-notifications': { partnershipInboundNotificationEmail, getPartnershipAlertRecipients: market => { markets.push(market); return ['owner@example.test'] } },
  })
  const route = load(path.join(root, 'app/api/marketing/dialer/call-status/route.ts'))
  const callback = async (extra = {}, query = '') => {
    const url = 'https://crm.fixture/api/marketing/dialer/call-status' + query
    const form = new URLSearchParams({ From: `sip:${caller}@sip.telnyx.com`, To: `sip:${line}@saturn-gta-76ee90d5.sip.twilio.com;transport=tls`, SipDomainSid: 'SDfixture', Direction: 'inbound', CallSid: sid, CallStatus: 'completed', DialCallStatus: 'completed', DialCallDuration: '38', DialBridged: 'true', ...extra })
    const suffix = [...form.keys()].sort().map(key => key + form.get(key)).join('')
    const signature = createHmac('sha1', 'fixture-secret').update(url + suffix).digest('base64')
    return route.POST(new Request(url, { method: 'POST', headers: { 'x-twilio-signature': signature }, body: form.toString() }))
  }
  return { callback, route, alerts, touches, receipts, tasks, markets, writes, reads, failAlerts: value => { alertFailure = value }, close: () => { globalThis.fetch = original } }
}
test('signed Toronto SIP callback queues an unsaved caller alert without manufacturing a contact or sales lead', async () => {
  const f = fixture()
  try {
    const response = await f.callback()
    assert.equal(response.status, 200); assert.match(await response.text(), /<Hangup\/>/)
    assert.equal(f.alerts.size, 1); assert.equal(f.touches.size, 0)
    const alert = [...f.alerts.values()][0]
    assert.match(alert.subject, /Partner inbound call/); assert.match(alert.subject, /14165550199/)
    assert.match(alert.html, /Unsaved caller/); assert.match(alert.html, /38 seconds/)
    assert.match(alert.html, /sales\/interactions/); assert.deepEqual(f.markets, ['toronto'])
    assert.match(alert.html, /background:#1a2744/); assert.match(alert.html, /Review Call Intake/)
    assert.equal(alert.context.callSid, sid); assert.equal(alert.context.identity, 'unknown'); assert.equal(alert.context.contactId, null)
    assert.ok(f.writes.every(table => table === 'enqueue_internal_alert'))
    assert.match(f.receipts[0].raw, /sip%3A/); assert.equal(f.receipts[0].source, 'partnership_call_status')
    await f.callback(); assert.equal(f.alerts.size, 1, 'Provider retries reuse the same durable alert identity')
  } finally { f.close() }
})
test('normalized phone identity works for imported formatting and a partner in another market', async () => {
  const f = fixture({ contacts: [{ id: 'partner', name: '<Caller & Co>', phone: '(416) 555-0199', city: 'Windsor' }] })
  try {
    await f.callback(); await f.callback()
    assert.equal(f.alerts.size, 1); assert.equal(f.touches.size, 1)
    const alert = [...f.alerts.values()][0]
    assert.match(alert.html, /Caller &amp; Co/); assert.doesNotMatch(alert.html, /<Caller/)
    assert.match(alert.html, /contact=partner/); assert.deepEqual(f.markets, ['toronto', 'toronto'])
    assert.match(alert.html, /Open Partner Thread/); assert.ok(!f.reads.includes('subcontractors'))
  } finally { f.close() }
})
test('saved subcontractor caller uses the established email layout and its own record without creating a partner or lead', async () => {
  const f = fixture({ contractors: [{ id: 'paradise', company_name: 'Paradise Movers', contact_name: 'John', phone: '(416) 555-0199' }] })
  try {
    await f.callback(); await f.callback()
    assert.equal(f.alerts.size, 1); assert.equal(f.touches.size, 0)
    const alert = [...f.alerts.values()][0]
    assert.match(alert.subject, /John — Paradise Movers/)
    assert.match(alert.html, /<strong>Contact:<\/strong> John/); assert.match(alert.html, /<strong>Company:<\/strong> Paradise Movers/)
    assert.match(alert.html, /background:#1a2744/); assert.match(alert.html, /Open Subcontractor/)
    assert.match(alert.html, /sales\/contractors\/paradise/); assert.match(alert.html, /0m 38s/)
    assert.doesNotMatch(alert.html, /Unsaved caller|identity is not confirmed|marketing\/partners/)
    assert.equal(alert.context.contactId, null); assert.equal(alert.context.subcontractorId, 'paradise'); assert.equal(alert.context.identity, 'matched')
    assert.ok(f.writes.every(table => table === 'enqueue_internal_alert'))
  } finally { f.close() }
})
test('subcontractor placeholders do not become a personal name, and email labels remain escaped', async () => {
  const f = fixture({ contractors: [{ id: 'crew', company_name: '<Crew & Co>', contact_name: 'Owner / crew manager (not yet confirmed)', phone: caller }] })
  try {
    await f.callback()
    const alert = [...f.alerts.values()][0]
    assert.match(alert.html, /&lt;Crew &amp; Co&gt;/); assert.doesNotMatch(alert.html, /<Crew|Owner \/ crew manager/)
    assert.match(alert.html, /Open Subcontractor/)
  } finally { f.close() }
})
test('ambiguous, failed and partial subcontractor matches keep identity uncertainty instead of guessing', async () => {
  for (const [options, expected] of [
    [{ contractors: [{ id: 'a', phone: caller }, { id: 'b', phone: caller }] }, /Caller identity needs review/],
    [{ contractorLookupFailed: true }, /Contact lookup unavailable/],
    [{ contractors: [{ id: 'wrong', phone: '+16475550199', company_name: 'Wrong company' }] }, /Unsaved caller/],
  ]) {
    const f = fixture(options)
    try {
      await f.callback(); const alert = [...f.alerts.values()][0]
      assert.match(alert.html, expected); assert.equal(alert.context.subcontractorId, null); assert.equal(f.touches.size, 0)
      assert.match(alert.html, /sales\/interactions/); assert.doesNotMatch(alert.html, /Wrong company|Open Subcontractor/)
    } finally { f.close() }
  }
})
test('unknown, ambiguous and failed identity reads still notify with explicit uncertainty', async () => {
  for (const [options, label] of [[{ lookupFailed: true }, /Contact lookup unavailable/], [{ contacts: [{ id: 'a', phone: caller }, { id: 'b', phone: caller }] }, /Caller identity needs review/]]) {
    const f = fixture(options)
    try { await f.callback(); assert.equal(f.alerts.size, 1); assert.match([...f.alerts.values()][0].html, label); assert.equal(f.touches.size, 0) } finally { f.close() }
  }
})
test('Sales fallback defers the final alert until the final leg resolves', async () => {
  const f = fixture({ fallback: true })
  try {
    const first = await f.callback({ CallStatus: 'in-progress', DialCallStatus: 'no-answer', DialCallDuration: '0', DialBridged: 'false' })
    assert.match(await first.text(), /<Client>/); assert.equal(f.alerts.size, 0); assert.equal(f.tasks.length, 0)
    await f.callback({}, '?salesFallback=1')
    assert.equal(f.alerts.size, 1); assert.match([...f.alerts.values()][0].subject, /Partner inbound call/); assert.equal(f.tasks.length, 0)
  } finally { f.close() }
})
test('an unanswered final leg creates the missed-call alert and preserves the existing callback task', async () => {
  const f = fixture({ fallback: true })
  try {
    await f.callback({ CallStatus: 'in-progress', DialCallStatus: 'no-answer', DialCallDuration: '0', DialBridged: 'false' }, '?salesFallback=1')
    assert.equal(f.alerts.size, 1); assert.match([...f.alerts.values()][0].subject, /Missed partner call/)
    assert.deepEqual(f.tasks[0], [null, sid, caller])
  } finally { f.close() }
})
test('outbound, nonterminal and unsigned callbacks cannot generate inbound call mail', async () => {
  const f = fixture()
  try {
    await f.callback({ From: line, To: caller, Direction: 'outbound-api' })
    await f.callback({ CallStatus: 'in-progress', DialCallStatus: '' })
    await f.callback({ CallStatus: 'ringing', DialCallStatus: '' })
    const captured = f.receipts.length
    const response = await f.route.POST(new Request('https://crm.fixture/api/marketing/dialer/call-status', { method: 'POST', body: 'CallSid=' + sid }))
    assert.equal(response.status, 401); assert.equal(f.receipts.length, captured)
    assert.equal(f.alerts.size, 0); assert.equal(f.tasks.length, 0)
  } finally { f.close() }
})
test('SIP user normalization never includes digits from the host, even without the ingress rewrite', async () => {
  const f = fixture({ approvedSip: false })
  try { await f.callback(); assert.equal(f.alerts.size, 1); assert.match([...f.alerts.values()][0].subject, /14165550199/) } finally { f.close() }
})
test('outbox failure is not acknowledged as a successful notification, and retry does not duplicate the contact touch', async () => {
  const f = fixture({ contacts: [{ id: 'partner', name: 'Fixture Partner', phone: caller, city: 'Toronto' }] })
  try {
    f.failAlerts(true); await assert.rejects(() => f.callback(), /Internal alert delivery storage unavailable/)
    assert.equal(f.alerts.size, 0); assert.equal(f.touches.size, 1)
    f.failAlerts(false); assert.equal((await f.callback()).status, 200)
    assert.equal(f.touches.size, 1); assert.equal(f.alerts.size, 1)
  } finally { f.close() }
})
test('subcontractor alert storage failure also propagates and retries retain one durable alert', async () => {
  const f = fixture({ contractors: [{ id: 'crew', company_name: 'Saved Crew', phone: caller }] })
  try {
    f.failAlerts(true); await assert.rejects(() => f.callback(), /Internal alert delivery storage unavailable/)
    assert.equal(f.alerts.size, 0)
    f.failAlerts(false); await f.callback(); await f.callback()
    assert.equal(f.alerts.size, 1); assert.equal(f.touches.size, 0)
  } finally { f.close() }
})
