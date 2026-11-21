import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { authorizeTwilioWebhook, verifyTwilioSignature } from '../../lib/server/security'
import { authorizeInboundEmail } from '../../lib/server/inbound-email-auth'

const origin = 'https://crm.example.test'
const token = 'test-twilio-token-not-a-credential'
const secretBytes = Buffer.from('test-webhook-key-not-a-credential')
const secret = `whsec_${secretBytes.toString('base64')}`

async function env(fn: () => Promise<void> | void) {
  const keys = ['TWILIO_AUTH_TOKEN', 'NEXT_PUBLIC_APP_URL', 'RESEND_WEBHOOK_SECRET', 'WORKER_SHARED_SECRET']
  const previous = keys.map(key => process.env[key])
  Object.assign(process.env, { TWILIO_AUTH_TOKEN: token, NEXT_PUBLIC_APP_URL: origin,
    RESEND_WEBHOOK_SECRET: secret, WORKER_SHARED_SECRET: 'test-worker-secret' })
  try { await fn() } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i] })
  }
}
function twilioRequest(url: string, body: string, signedUrl = url) {
  const params = new URLSearchParams(body)
  let input = signedUrl
  for (const key of Array.from(new Set(params.keys())).sort()) {
    for (const value of Array.from(new Set(params.getAll(key))).sort()) input += key + value
  }
  const sig = createHmac('sha1', token).update(input).digest('base64')
  return new Request(url, { method: 'POST', body, headers: { 'x-twilio-signature': sig } })
}
function emailRequest(body: string, age = 0) {
  const id = 'msg_test'; const timestamp = String(Math.floor(Date.now() / 1000) - age)
  const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64')
  return new Request(`${origin}/api/sales/inbox/email-inbound`, { method: 'POST', body,
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } })
}
// Execute actual route source with all service dependencies fenced off. No network/DB is available.
function route(path: string, mocks: Record<string, unknown> = {}, fetchMock?: typeof fetch) {
  const exports: Record<string, (r: Request) => Promise<Response>> = {}
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const forbidden = new Proxy({}, { get: (_target, key) => () => { throw new Error(`Unexpected side effect: ${String(key)}`) } })
  runInNewContext(source, { exports, require: (name: string) => {
    if (name === '@/lib/server/security') return { authorizeTwilioWebhook }
    if (name === '@/lib/server/inbound-email-auth') return { authorizeInboundEmail }
    if (name === 'next/server') return { NextResponse: { json: Response.json.bind(Response) } }
    return mocks[name] || forbidden
  }, Request, Response, URL, URLSearchParams, Buffer, crypto: webcrypto, console,
  fetch: fetchMock || (() => { throw new Error('Network forbidden') }) })
  return exports.POST
}

test('Twilio validates exact URL/query/body; rejects tampering and missing credentials', () => env(async () => {
  const url = `${origin}/callback?branchNumber=%2B15551234567`
  const body = 'From=%2B15555550123&CallStatus=no-answer&Extra=one&Extra=two'
  assert.equal(await verifyTwilioSignature(twilioRequest(url, body), body), true)
  assert.equal(await verifyTwilioSignature(twilioRequest(url, body), body + '&CallDuration=20'), false)
  assert.equal(await verifyTwilioSignature(twilioRequest(url + '&changed=1', body, url), body), false)
  assert.equal((await authorizeTwilioWebhook(new Request(url), body))?.status, 401)
  delete process.env.TWILIO_AUTH_TOKEN
  assert.equal((await authorizeTwilioWebhook(twilioRequest(url, body), body))?.status, 503)
}))

test('Twilio supports configured external origin but does not trust forwarded headers', () => env(async () => {
  const local = 'http://internal.test/callback?x=%2B1'; const body = 'CallStatus=completed'
  assert.equal(await verifyTwilioSignature(twilioRequest(local, body, `${origin}/callback?x=%2B1`), body), true)
  const forged = twilioRequest(local, body, 'https://untrusted.test/callback?x=%2B1')
  forged.headers.set('x-forwarded-host', 'untrusted.test')
  forged.headers.set('x-forwarded-proto', 'https')
  assert.equal(await verifyTwilioSignature(forged, body), false)
}))

test('Resend verifies raw body and freshness; malformed/missing secrets fail closed', () => env(() => {
  const body = '{"from":"sender@example.test","body":"hello"}'
  assert.deepEqual(authorizeInboundEmail(emailRequest(body), body), { authorized: true, isWorker: false })
  for (const [request, content] of [[emailRequest(body), body + ' '], [emailRequest(body, 600), body],
    [emailRequest(body, -600), body], [new Request(origin), body]] as const) {
    assert.equal(authorizeInboundEmail(request, content).authorized, false)
  }
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_!'
  assert.equal(authorizeInboundEmail(emailRequest(body), body).authorized, false)
  delete process.env.RESEND_WEBHOOK_SECRET
  const result = authorizeInboundEmail(emailRequest(body), body)
  assert.equal(result.authorized, false)
  if (!result.authorized) assert.equal(result.response.status, 503)
}))

test('Only the correct legacy worker secret bypasses provider verification', () => env(() => {
  delete process.env.RESEND_WEBHOOK_SECRET
  for (const value of ['', 'wrong']) {
    assert.equal(authorizeInboundEmail(new Request(origin, { headers: { 'x-internal-secret': value } }), '{}').authorized, false)
  }
  assert.deepEqual(authorizeInboundEmail(new Request(origin, { headers: { 'x-internal-secret': 'test-worker-secret' } }), '{}'), { authorized: true, isWorker: true })
  delete process.env.WORKER_SHARED_SECRET
  assert.equal(authorizeInboundEmail(new Request(origin), '{}').authorized, false)
}))

for (const name of ['call-status', 'missed-call', 'dial-status']) {
  test(`${name} route rejects unsigned and altered requests before any service call`, () => env(async () => {
    const post = route(`app/api/sales/dialer/${name}/route.ts`)
    const url = `${origin}/api/sales/dialer/${name}`
    const body = 'From=%2B15555550123&CallStatus=no-answer&DialCallStatus=no-answer'
    assert.equal((await post(new Request(url, { method: 'POST', body }))).status, 401)
    const request = twilioRequest(url, body)
    assert.equal((await post(new Request(request, { body: body + '&From=changed' }))).status, 401)
    delete process.env.TWILIO_AUTH_TOKEN
    assert.equal((await post(twilioRequest(url, body))).status, 503)
  }))
}

test('Signed call-status still sends the intended missed-call message', () => env(async () => {
  let sends = 0; let alerts = 0
  const post = route('app/api/sales/dialer/call-status/route.ts', {
    '@/lib/server/carrier-voice': { carrierVoiceForm: (body: string) => new URLSearchParams(body) },
    '@/lib/server/interactions': { captureTwilioInteraction: async () => 'receipt' },
    '@/lib/server/callback-actions': { reserveMissedCallReply: async () => true, recordMissedCallReply: async () => undefined },
    '@/lib/server/dialer-settings': { getDialerSettings: async () => ({ blockedCallers: [] }), findBlockedCaller: () => null },
    '@/lib/server/sms-provider': { sendSmsProviderRequest: async (_url: string, init: RequestInit) => {
      sends++; const data = new URLSearchParams(String(init.body))
      assert.equal(data.get('To'), '+15555550123'); assert.match(data.get('Body') || '', /Hi Jane!/)
      return Response.json({ sid: 'SM' + 'a'.repeat(32) })
    } },
    '@/lib/telephony-providers': { isSmsProviderReceipt: (sid: unknown) => typeof sid === 'string' && /^SM[a-f0-9]{32}$/i.test(sid) },
    '@/lib/sales-phones': { normalizePhone: (x: string) => x, pickSaturnBranchPhoneNumber: () => '+15555550124', getSaturnBranchLabel: () => 'Windsor' },
    '@/lib/server/runtime': { getTwilioCredentials: () => ({ accountSid: 'ACtest', authToken: token }) },
    '@/lib/server/twilio-recordings': { twilioAuth: () => 'test-auth' },
    '@/lib/server/sales-repository': { listSalesLeads: async () => [{ id: 'lead-test', phone: '+15555550123', name: 'Jane Test' }] },
    '@/lib/server/sales-alerts': { createSalesSystemAlert: async () => { alerts++ } },
  })
  const body = 'From=%2B15555550123&CallStatus=no-answer'
  assert.equal((await post(twilioRequest(`${origin}/api/sales/dialer/call-status`, body))).status, 204)
  assert.equal(sends, 1); assert.equal(alerts, 1)
}))

test('Email route rejects unauthorized requests before parsing or mutating; signed reply still routes', () => env(async () => {
  let matches = 0
  const post = route('app/api/sales/inbox/email-inbound/route.ts', {
    '@/lib/server/interactions': { storeInteraction: async () => 'receipt' },
    '@/lib/server/partnership-inbound': { pausePartnershipSequenceForInbound: async () => { matches++; return { matched: true, contactId: 'test-contact' } } },
  })
  assert.equal((await post(new Request(origin, { method: 'POST', body: 'not-json' }))).status, 401)
  assert.equal(matches, 0)
  const body = '{"from":"sender@example.test","body":"hello"}'
  assert.equal((await post(emailRequest(body))).status, 200)
  assert.equal(matches, 1)
  delete process.env.RESEND_WEBHOOK_SECRET
  assert.equal((await post(new Request(origin, { method: 'POST', body }))).status, 503)
  assert.equal(matches, 1)
}))
