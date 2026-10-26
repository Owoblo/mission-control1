import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url), createLoader = require('../helpers/load-typescript.cjs'), root = path.resolve('.')
const runtime = { getAppBaseUrl: () => 'https://crm.fixture', requireSupabaseEnv: () => ({ url: 'https://database.fixture', headers: {} }), readEnv: () => '' }

function notificationFixture({ leads = [], threads = [], emails = [], logs = [], missing = [] } = {}) {
  const original = globalThis.fetch, originalNow = Date.now
  let now = originalNow(), session = { role: 'owner', userId: 'owner', name: 'Owner' }
  const receipts = [], scopeReads = []
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(input)
    assert.equal(u.hostname, 'database.fixture')
    if (u.pathname.endsWith('crm_leads')) { scopeReads.push(u); return Response.json(missing) }
    assert.ok(u.pathname.endsWith('analytics_events'))
    if (init.method === 'POST') { receipts.push(...JSON.parse(init.body)); return new Response(null, { status: 201 }) }
    return Response.json(receipts.filter(row => row.rep_id === session.userId && row.event_type === 'notification_disposition'))
  }
  const load = createLoader(root, {
    '@/lib/server/session': { getSessionUser: async () => session }, '@/lib/server/runtime': runtime,
    '@/lib/server/sales-repository': {
      listAllInboundLeads: async () => [], listSalesLeadInboxSnapshots: async () => [...leads],
      listSalesEmails: async () => emails, listFollowUpLogs: async () => logs,
      listNurtureNotificationLeads: async () => [], listContractorPriceResponseLeads: async () => [],
    },
    '@/lib/server/sms-threads': { listSmsMessages: async () => [], buildSmsThreads: () => threads },
  })
  const route = load(path.join(root, 'app/api/sales/notifications/route.ts'))
  return {
    get: async () => (await route.GET()).json(), scopeReads,
    open: key => route.POST(new Request('https://crm.fixture', { method: 'POST', body: JSON.stringify({ dedupeKeys: [key], action: 'opened' }) })),
    as: value => { session = value }, tick: () => { now += 61_000; Date.now = () => now },
    close: () => { globalThis.fetch = original; Date.now = originalNow },
  }
}

test('opening one SMS notification never hides the next message from that customer, including after a reload', async () => {
  const at = new Date().toISOString(), phone = '+14165550199'
  const thread = { contactPhone: phone, lastAt: at, lastMessage: 'First question', unread: true, leadId: 'lead', businessNumber: '+14377823004', messages: [{ id: 'first', direction: 'inbound' }] }
  const f = notificationFixture({ leads: [{ id: 'lead', branch: 'toronto' }], threads: [thread] })
  try {
    const first = (await f.get()).items[0]
    await f.open(first.dedupeKey)
    assert.equal((await f.get()).items.length, 0)
    thread.messages.push({ id: 'second', direction: 'inbound' }); thread.lastMessage = 'A new question'; f.tick()
    const second = (await f.get()).items[0]
    assert.notEqual(second.id, first.id); assert.notEqual(second.dedupeKey, first.dedupeKey)
    assert.equal(second.preview, 'A new question')
  } finally { f.close() }
})

test('older alert leads outside the 300-row inbox projection retain their real branch and assignment', async () => {
  const now = new Date().toISOString()
  const f = notificationFixture({
    logs: ['old-windsor','old-ottawa'].map((leadId, i) => ({ id: `alert-${i}`, leadId, date: now, notes: '[SYSTEM ALERT][critical] Follow up\nCustomer needs help' })),
    missing: [{ id: 'old-windsor', branch: 'windsor' }, { id: 'old-ottawa', branch: 'ottawa' }],
  })
  try {
    f.as({ role: 'manager', userId: 'ottawa', name: 'Ottawa manager', branch: 'ottawa' })
    const data = await f.get()
    assert.deepEqual(data.items.map(item => item.leadId), ['old-ottawa'])
    assert.match(f.scopeReads[0].searchParams.get('id'), /old-windsor/)
    assert.doesNotMatch(f.scopeReads[0].searchParams.get('select'), /callLogs|transcript/)
  } finally { f.close() }
})

test('health-check emails cannot appear as unread customer mail and unlinked mail is not shared across branches', async () => {
  const emails = [{ id: 'health', direction: 'inbound', from: 'leadflow.health@system.invalid', sentAt: new Date().toISOString() }, { id: 'customer', direction: 'inbound', from: 'customer@example.test', sentAt: new Date().toISOString() }]
  const f = notificationFixture({ emails })
  try {
    assert.deepEqual((await f.get()).items.map(item => item.id), ['email-customer'])
    f.as({ role: 'manager', userId: 'ottawa', name: 'Ottawa manager', branch: 'ottawa' })
    assert.equal((await f.get()).items.length, 0)
  } finally { f.close() }
})

test('a missing notification permission lookup fails visibly instead of returning an empty success', async () => {
  const f = notificationFixture({ logs: [{ id: 'log', leadId: 'missing', date: new Date().toISOString(), notes: '[SYSTEM ALERT][critical] Alert' }] })
  try {
    globalThis.fetch = async input => new URL(input).pathname.endsWith('crm_leads') ? new Response(null, { status: 503 }) : Response.json([])
    assert.match((await f.get()).error, /temporarily unavailable/)
  } finally { f.close() }
})

test('legacy sales alerts use the current staff roster and durable queue, with stable retry keys and escaped customer text', async () => {
  const original = globalThis.fetch, queued = new Map()
  globalThis.fetch = async (input, init) => {
    const u = new URL(input); assert.equal(u.hostname, 'database.fixture')
    if (u.pathname.endsWith('crm_sales_alert_recipients')) return Response.json(['business@starmovers.ca','thelma.ufot@starmovers.ca','rep@example.test'])
    assert.ok(u.pathname.endsWith('enqueue_internal_alert')); const body = JSON.parse(init.body)
    queued.set(body.p_event, body.p_payload); return Response.json(null)
  }
  try {
    const alerts = createLoader(root, { '@/lib/server/runtime': runtime, './runtime': runtime })(path.join(root, 'lib/server/internal-notifications.ts'))
    const html = alerts.smsNotificationEmail('Customer', '<img src=x onerror=alert(1)>')
    assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/)
    await alerts.sendRepAlertEmail('Customer reply', html, undefined, 'sms:provider-id')
    await alerts.sendRepAlertEmail('Customer reply', html, undefined, 'sms:provider-id')
    assert.equal(queued.size, 1); assert.ok(queued.get('sms:provider-id').recipients.includes('rep@example.test'))
    globalThis.fetch = async () => new Response(null, { status: 503 })
    await assert.rejects(alerts.sendRepAlertEmail('Reply', html), /recipients/)
  } finally { globalThis.fetch = original }
})

test('a contractor webhook retry repairs an alert failure even after the task was saved', async () => {
  const original = globalThis.fetch; let taskSaved = false, failAlert = true
  const alerts = new Map(), tasks = new Map()
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(input).hostname, 'database.fixture')
    const body = JSON.parse(init.body)
    if (String(input).includes('/crm_tasks?')) {
      tasks.set(body.id, body); const created = !taskSaved; taskSaved = true
      return Response.json(created ? [body] : [])
    }
    assert.ok(String(input).includes('/enqueue_internal_alert'))
    if (failAlert) return new Response(null, { status: 503 })
    alerts.set(body.p_event, body.p_payload); return Response.json(null)
  }
  try {
    const { notifyContractorInbound } = createLoader(root, { './runtime': runtime, '@/lib/server/runtime': runtime })(path.join(root, 'lib/server/contractor-inbound.ts'))
    const contractor = { id: 'crew', company_name: 'Crew', phone: '+14165550199' }
    const input = { from: contractor.phone, to: '+14374650584', body: 'Please call', sid: 'provider', at: new Date().toISOString() }
    await assert.rejects(notifyContractorInbound(contractor, input), /storage unavailable/)
    failAlert = false
    await notifyContractorInbound(contractor, input); await notifyContractorInbound(contractor, input)
    assert.equal(tasks.size, 1); assert.equal(alerts.size, 1)
    assert.deepEqual([...alerts.values()][0].recipients, ['business@starmovers.ca'])
  } finally { globalThis.fetch = original }
})

test('an email import retry repairs its notification without replaying customer automation', async () => {
  const original = globalThis.fetch, saved = new Map(), alerts = new Map()
  let fail = true, automation = 0
  globalThis.fetch = async input => {
    const u = new URL(input); assert.equal(u.hostname, 'database.fixture')
    return Response.json([...saved.values()].map(email => ({ id: email.id, templateType: email.templateType })))
  }
  const route = createLoader(root, {
    '@/lib/server/runtime': { ...runtime, getWorkerSharedSecret: () => 'fixture' },
    '@/lib/server/partnership-inbound': { pausePartnershipSequenceForInbound: async () => ({ matched: false }) },
    '@/lib/server/sales-automation': { processInboundAutomationEvent: async () => { automation++; return { lead: null } } },
    '@/lib/server/sales-repository': { saveSalesEmail: async email => saved.set(email.id, email), saveFollowUpLog: async () => {} },
    '@/lib/server/internal-notifications': { sendRepAlertEmail: async (subject, html, recipients, key) => { if (fail) throw Error('Fixture queue unavailable'); alerts.set(key, { subject, html }) } },
  })(path.join(root, 'app/api/sales/inbox/email-inbound/route.ts'))
  const request = () => new Request('https://crm.fixture', { method: 'POST', headers: { 'x-internal-secret': 'fixture' }, body: JSON.stringify({ from: 'customer@example.test', body: 'Please call', providerMessageId: 'message' }) })
  try {
    assert.equal((await route.POST(request())).status, 500)
    fail = false
    assert.equal((await route.POST(request())).status, 200)
    assert.equal((await route.POST(request())).status, 200)
    assert.equal(automation, 1); assert.equal(saved.size, 1); assert.equal(alerts.size, 1)
  } finally { globalThis.fetch = original }
})

test('a replayed partner SMS repairs the same durable alert without generating a second relationship touch', async () => {
  const original = globalThis.fetch, alerts = new Map()
  let fail = true
  const contact = { id: 'partner', name: 'Partner', city: 'Toronto', phone: '+14165550199', stage: 'connected' }
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(input); assert.equal(u.hostname, 'database.fixture')
    assert.equal(init.method || 'GET', 'GET', 'Replay must not manufacture another touch')
    if (u.pathname.endsWith('market_contacts')) return Response.json([contact])
    if (u.pathname.endsWith('market_touches')) return Response.json([{ id: 'saved-touch' }])
    throw Error('Unexpected read')
  }
  const { pausePartnershipSequenceForInbound } = createLoader(root, {
    '@/lib/server/runtime': runtime,
    '@/lib/server/partnership-inbound-pause': { persistPartnershipInboundPause: async () => {} },
    './ignored-partnership-inbound': { ignoresPartnershipInbound: () => false },
    '@/lib/server/partnership-card-fulfillment': { queueRequestedOttawaCard: async () => {} },
    '@/lib/server/internal-notifications': { getPartnershipAlertRecipients: () => ['owner@example.test'], partnershipInboundNotificationEmail: () => 'fixture', sendRepAlertEmail: async (subject, html, recipients, key) => { if (fail) throw Error('Fixture queue unavailable'); alerts.set(key, { subject }) } },
  })(path.join(root, 'lib/server/partnership-inbound.ts'))
  const input = { channel: 'sms', phone: contact.phone, notes: 'Please send your card', metadata: { messageSid: 'SM' + 'a'.repeat(32) } }
  try {
    await assert.rejects(pausePartnershipSequenceForInbound(input))
    fail = false
    await pausePartnershipSequenceForInbound(input); await pausePartnershipSequenceForInbound(input)
    assert.equal(alerts.size, 1)
  } finally { globalThis.fetch = original }
})
