import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url), createLoader = require('../helpers/load-typescript.cjs')
const a = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
function fixture(actor = { role: 'owner', userId: 'owner', name: 'Owner' }) {
  const tables = {
    market_contacts: [{ id: a, name: 'Ottawa fixture', city: 'Ottawa', stage: 'engaged', owner_name: null }, { id: b, name: 'Windsor fixture', city: 'Windsor', stage: 'engaged' }],
    market_touches: [{ id: 'request', contact_id: a, direction: 'inbound', channel: 'sms', outcome_code: 'package_requested', notes: 'Please send a digital card', created_at: '2026-10-20T12:00:00Z' }],
    crm_tasks: [], partner_activity_logs: [], email_provider_events: [],
  }
  const calls = [], writes = [], original = globalThis.fetch
  let failTable, failLog = false
  globalThis.fetch = async (endpoint, options = {}) => {
    const u = new URL(endpoint), table = u.pathname.split('/').at(-1), q = u.searchParams
    assert.equal(u.hostname, 'database.fixture', 'No outbound provider or external service can be called')
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`)
    calls.push({ table, method: options.method || 'GET', query: q })
    if (table === failTable || (table === 'partner_activity_logs' && options.method && failLog)) return new Response('', { status: 503 })
    let rows = tables[table]
    if (options.method === 'POST') {
      const value = JSON.parse(options.body); writes.push({ table, value })
      const field = q.get('on_conflict') || 'id'
      const existing = rows.find(r => r[field] === value[field])
      if (!existing) rows.push({ ...value, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      if (options.headers.Prefer.includes('return=minimal')) return new Response(null, { status: 204 })
      return Response.json(existing ? [] : [value])
    }
    const and = q.get('and')?.match(/id\.eq\.([0-9a-f-]+)/)?.[1]
    if (and) rows = rows.filter(r => r.id === and)
    for (const field of ['id', 'contact_id', 'related_id', 'updated_at', 'status', 'provider_message_id']) {
      const filter = q.get(field)
      if (filter?.startsWith('gt.')) rows = rows.filter(r => r[field] > filter.slice(3))
      else if (filter?.startsWith('eq.')) rows = rows.filter(r => r[field] === filter.slice(3))
      else if (filter?.startsWith('in.(')) rows = rows.filter(r => filter.slice(4, -1).split(',').map(v => v.replace(/^"|"$/g, '')).includes(r[field]))
    }
    if (q.get('action')?.startsWith('in.(')) rows = rows.filter(r => q.get('action').slice(4,-1).split(',').includes(r.action))
    if (options.method === 'PATCH') {
      const value = JSON.parse(options.body); writes.push({ table, value })
      for (const row of rows) Object.assign(row, value)
      return Response.json(rows)
    }
    return Response.json([...rows].sort((a,b) => a.id.localeCompare(b.id)))
  }
  const runtime = { requireSupabaseEnv: () => ({ url: 'https://database.fixture', headers: { 'Content-Type': 'application/json' } }) }
  const load = createLoader(resolve('.'), { '@/lib/server/request-session': { getRequestSessionUser: async () => actor }, './runtime': runtime })
  const route = load(resolve('app/api/marketing/next-steps/route.ts'))
  const get = (id = a) => route.GET(new Request('https://crm.fixture/api/marketing/next-steps' + (id ? `?contactId=${id}` : '')))
  const post = (step, action, extra = {}) => route.POST(new Request('https://crm.fixture/api/marketing/next-steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: a, key: step.key, evidenceVersion: step.evidenceVersion, action, ...extra }) }))
  return { tables, calls, writes, get, post, setFail: table => { failTable = table }, failLog: () => { failLog = true }, close: () => { globalThis.fetch = original } }
}
test('actual route denies anonymous and staff outside partnership scope before reading associated evidence', async () => {
  for (const actor of [null, { role: 'sales_rep' }]) { const f = fixture(actor); try { assert.equal((await f.get()).status, 401); assert.equal(f.calls.length, 0) } finally { f.close() } }
  const f = fixture({ role: 'partnership_manager', userId: 'ottawa', name: 'Ottawa Manager', branch: 'ottawa' })
  try {
    assert.equal((await f.get(b)).status, 403)
    assert.ok(f.calls.every(c => c.table === 'market_contacts'))
    const response = await f.get(''), body = await response.json()
    assert.equal(response.status, 200); assert.ok(body.rows.every(r => r.contactId === a))
    assert.ok(f.calls.filter(c => c.table !== 'market_contacts').every(c => (c.query.get('contact_id') || c.query.get('related_id')).includes(a)))
  } finally { f.close() }
})
test('actual loader preserves single-contact filtering across all pages and fails closed on partial reads', async () => {
  const f = fixture()
  try {
    const response = await f.get(), body = await response.json()
    assert.equal(response.status, 200); assert.equal(body.rows.length, 1)
    const pages = f.calls.filter(c => c.table === 'market_contacts')
    assert.equal(pages.length, 2); assert.ok(pages.every(c => c.query.get('and') === `(id.eq.${a})`))
    f.setFail('crm_tasks')
    const failed = await f.get(); assert.equal(failed.status, 503); assert.equal((await failed.json()).coverage.complete, false)
    assert.equal(f.writes.length, 0)
  } finally { f.close() }
})
test('visible exposure is durable and idempotent without changing evidence version; stale decisions cannot mutate', async () => {
  const f = fixture()
  try {
    const step = (await (await f.get()).json()).rows[0]
    assert.equal((await f.post(step, 'shown')).status, 200); assert.equal((await f.post(step, 'shown')).status, 200)
    assert.equal(f.tables.partner_activity_logs.length, 1)
    assert.equal((await (await f.get()).json()).rows[0].evidenceVersion, step.evidenceVersion)
    f.tables.market_touches[0].notes = 'Changed conversation'
    const before = f.writes.length
    assert.equal((await f.post(step, 'create_task')).status, 409); assert.equal(f.writes.length, before)
  } finally { f.close() }
})
test('task creation is stable, later review preserves ownership, and correction never asserts delivery', async () => {
  const f = fixture()
  try {
    let step = (await (await f.get()).json()).rows[0]
    assert.equal((await f.post(step, 'create_task')).status, 200)
    assert.equal(f.tables.crm_tasks.length, 1); assert.equal(f.tables.crm_tasks[0].owner_name, 'Owner')
    assert.equal((await f.post(step, 'create_task')).status, 409)
    step = (await (await f.get()).json()).rows[0]
    assert.equal((await f.post(step, 'defer', { dueAt: new Date(Date.now() + 86400000).toISOString() })).status, 200)
    step = (await (await f.get()).json()).rows[0]; assert.equal(step.state, 'waiting')
    assert.equal(f.tables.crm_tasks[0].owner_name, 'Owner')
    assert.equal((await f.post(step, 'correct', { note: 'The source was a quoted earlier request; human review recorded.' })).status, 200)
    step = (await (await f.get()).json()).rows[0]; assert.equal(step.state, 'reviewed'); assert.equal(step.delivery, null)
    assert.equal(f.tables.crm_tasks[0].status, 'open')
  } finally { f.close() }
})
test('receipt association validates identity, chronology and provider facts; delivery callback updates the same finding', async () => {
  const f = fixture()
  try {
    f.tables.market_touches.push({ id: 'receipt', contact_id: a, direction: 'outbound', channel: 'sms', notes: 'Requested digital card', created_at: '2026-10-21T12:00:00Z', metadata: { status: 'sent' } })
    let step = (await (await f.get()).json()).rows[0]
    assert.equal((await f.post(step, 'link_receipt', { receiptId: 'foreign' })).status, 400)
    assert.equal((await f.post(step, 'link_receipt', { receiptId: 'receipt' })).status, 200)
    step = (await (await f.get()).json()).rows[0]; assert.equal(step.state, 'submitted')
    f.tables.market_touches[1].metadata.status = 'delivered'
    step = (await (await f.get()).json()).rows[0]; assert.equal(step.state, 'fulfilled')
    assert.equal((await (await f.get('')).json()).total, 0)
  } finally { f.close() }
})
test('failed evidence journaling is reported instead of returning a successful review', async () => {
  const f = fixture()
  try {
    const step = (await (await f.get()).json()).rows[0]; f.failLog()
    assert.equal((await f.post(step, 'review')).status, 503)
    assert.equal(f.tables.partner_activity_logs.length, 0)
  } finally { f.close() }
})
test('existing fulfilment work is surfaced without loading attachments and prevents duplicate tasks', async () => {
  const f = fixture()
  try {
    f.tables.crm_tasks.push({ id: 'legacy', related_id: a, related_type: 'partner', category: 'partner_email_fulfilment', status: 'open', title: 'Requested documents', updated_at: '2026-10-21T12:00:00Z' })
    const body = await (await f.get()).json(), step = body.rows[0]
    assert.equal(body.existingWork[0].id, 'legacy')
    assert.equal((await f.post(step, 'create_task')).status, 409)
    assert.equal(f.tables.crm_tasks.length, 1)
    assert.ok(f.calls.filter(c => c.table === 'crm_tasks').every(c => !c.query.get('select')?.includes('description')))
  } finally { f.close() }
})
test('SES callback facts join by exact provider message and recipient, not opens or another contact', async () => {
  const f = fixture()
  try {
    f.tables.market_touches.push({ id: 'email', contact_id: a, direction: 'outbound', channel: 'email', notes: 'Requested card', created_at: '2026-10-21T12:00:00Z', metadata: { provider_id: 'ses-fixture', to: 'fixture@example.test' } })
    let step = (await (await f.get()).json()).rows[0]
    assert.equal((await f.post(step, 'link_receipt', { receiptId: 'email' })).status, 200)
    const event = { id: 'event', provider_message_id: 'ses-fixture', contact_id: null, recipient_email: 'fixture@example.test', occurred_at: '2026-10-21T12:01:00Z' }
    f.tables.email_provider_events.push({ ...event, event_type: 'email_opened' })
    assert.equal((await (await f.get()).json()).rows[0].state, 'submitted')
    f.tables.email_provider_events[0] = { ...event, event_type: 'email_delivered', recipient_email: 'someone-else@example.test' }
    assert.equal((await (await f.get()).json()).rows[0].state, 'submitted')
    f.tables.email_provider_events[0] = { ...event, event_type: 'email_delivered', contact_id: b }
    assert.equal((await (await f.get()).json()).rows[0].state, 'submitted')
    f.tables.email_provider_events[0] = { ...event, event_type: 'email_delivered' }
    const delivered = (await (await f.get()).json()).rows[0]
    assert.equal(delivered.state, 'fulfilled'); assert.equal(delivered.key, step.key)
    f.tables.email_provider_events.push({ ...event, id: 'later', event_type: 'email_bounced', occurred_at: '2026-10-21T12:02:00Z' })
    assert.equal((await (await f.get()).json()).rows[0].state, 'review')
    f.setFail('email_provider_events')
    assert.equal((await f.get()).status, 503)
  } finally { f.close() }
})
