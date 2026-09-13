import test from 'node:test'
import assert from 'node:assert/strict'
import { excludePartnershipMessages, isReplyToSalesSms } from '../../lib/server/partnership-message-context'
import { linkSmsMessagesToLead } from '../../lib/server/sales-automation-repository'
process.env.SUPABASE_URL = 'https://example.test'
process.env.SUPABASE_KEY = 'test'
const intro = { id: 'intro', twilio_sid: 'SMintro', lead_id: 'terry', direction: 'outbound', from_number: '+12262419853', to_number: '+15195743499' }
const sale = { ...intro, id: 'sale', twilio_sid: 'SMsale' }
const originalFetch = globalThis.fetch
function response(rows: unknown) { return new Response(JSON.stringify(rows), { status: 200 }) }
test('historically linked introduction is excluded; real customer message on same line survives', async () => {
  globalThis.fetch = async () => response([{ metadata: { twilioSid: 'SMintro' } }])
  try { assert.deepEqual(await excludePartnershipMessages([intro, sale]), [sale]) } finally { globalThis.fetch = originalFetch }
})
test('reply follows latest real sales question on partnership line', async () => {
  globalThis.fetch = async url => String(url).includes('sms_messages') ? response([sale]) : response([])
  try { assert.equal(await isReplyToSalesSms(intro.to_number, intro.from_number), true) } finally { globalThis.fetch = originalFetch }
})
test('legacy linked introduction does not turn a partnership reply into a customer reply', async () => {
  globalThis.fetch = async url => String(url).includes('sms_messages') ? response([intro]) : response([{ metadata: { twilioSid: 'SMintro' } }])
  try { assert.equal(await isReplyToSalesSms(intro.to_number, intro.from_number), false) } finally { globalThis.fetch = originalFetch }
})
test('unassigned partnership number history is not attached to a new sales lead', async () => {
  const patched: string[] = []
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PATCH') { patched.push(String(url)); return response([]) }
    if (String(url).includes('market_touches')) return response([{ metadata: { twilioSid: 'SMintro' } }])
    return response([{ ...intro, lead_id: null }, { ...sale, lead_id: null, from_number: '+15195551212' }])
  }
  try {
    await linkSmsMessagesToLead('new-lead', intro.to_number)
    assert.equal(patched.length, 1)
    assert.ok(patched[0].includes('id=in.(sale)'))
    assert.ok(patched[0].includes('lead_id=is.null'))
  } finally { globalThis.fetch = originalFetch }
})
test('ownership lookup failure stops linking instead of leaking partnership history', async () => {
  globalThis.fetch = async () => new Response('unavailable', { status: 503 })
  try { await assert.rejects(excludePartnershipMessages([intro]), /ownership/) } finally { globalThis.fetch = originalFetch }
})

test('ownership index reads every page and projects provider IDs only', async () => {
  const { listPartnershipMessageSids } = await import('../../lib/server/partnership-message-context')
  const urls: URL[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input)); urls.push(url)
    return response(url.searchParams.get('offset') === '0'
      ? Array.from({ length: 1000 }, (_, i) => ({ twilioSid: `SM${i}`, messageSid: null, twilio_sid: null }))
      : [{ twilioSid: null, messageSid: 'SMlast', twilio_sid: 'SMlegacy' }])
  }
  try {
    const sids = await listPartnershipMessageSids()
    assert.equal(sids.size, 1002)
    assert.ok(sids.has('SMlast'))
    assert.equal(urls.length, 2)
    assert.ok(urls[0].searchParams.get('select')?.includes('metadata->>twilioSid'))
  } finally { globalThis.fetch = originalFetch }
})

test('filtered inbox pages stay full, disjoint, and searchable by customer preview', async () => {
  const { paginateSalesSmsMessages, buildSmsThreads } = await import('../../lib/server/sms-threads')
  const messages = Array.from({ length: 320 }, (_, i) => ({
    ...sale, id: `row-${i}`, twilio_sid: `SM${i}`, direction: 'outbound' as const,
    to_number: `+1519555${String(i).padStart(4, '0')}`,
    created_at: new Date(Date.UTC(2026, 8, 9, 0, i)).toISOString(), body: `Move ${i}`,
  }))
  const partnerSids = new Set(messages.slice(280).map(row => row.twilio_sid))
  const filtered = await excludePartnershipMessages(messages, partnerSids)
  const first = buildSmsThreads(paginateSalesSmsMessages(filtered, 150), [], [], false)
  const second = buildSmsThreads(paginateSalesSmsMessages(filtered, 150, 150), [], [], false)
  assert.equal(first.length, 150)
  assert.equal(second.length, 130)
  assert.equal(new Set([...first, ...second].map(thread => thread.contactPhone)).size, 280)
  assert.equal(first[0].lastMessage, 'Move 279')
  assert.equal(paginateSalesSmsMessages(filtered, 150, 0, 'Move 319').length, 0)
  assert.equal(paginateSalesSmsMessages(filtered, 150, 0, 'Move 279').length, 1)
})

test('embedded partnership history is filtered again after merging', async () => {
  const { mergeInboundLeadSmsThreadMessages } = await import('../../lib/server/sms-threads')
  const inbound = { id: 'old', source: 'twilio_sms', phone: intro.to_number,
    created_at: '2026-09-09T12:00:00Z', raw_data: { to: intro.from_number,
      smsThread: [{ messageSid: intro.twilio_sid, body: 'Partner introduction', at: '2026-09-09T12:00:00Z' }] } }
  const merged = mergeInboundLeadSmsThreadMessages([], [inbound as never], intro.to_number)
  assert.equal(merged.length, 1)
  assert.deepEqual(await excludePartnershipMessages(merged, new Set([intro.twilio_sid])), [])
})

test('customer reply preserves the exact sales lead and accepts historical phone formats', async () => {
  const { getSalesSmsReplyLeadId } = await import('../../lib/server/partnership-message-context')
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    if (url.pathname.includes('sms_messages')) {
      assert.equal(url.searchParams.get('to_number'), 'in.(+15195743499,5195743499)')
      return response([sale])
    }
    return response([])
  }
  try { assert.equal(await getSalesSmsReplyLeadId('(519) 574-3499', intro.from_number), 'terry') }
  finally { globalThis.fetch = originalFetch }
})

test('inbox snapshot spans database pages and is shared across concurrent UI pages', async () => {
  const { listSmsThreadSummaryMessages, buildSmsThreads } = await import('../../lib/server/sms-threads')
  const oldUrl = process.env.SUPABASE_URL
  process.env.SUPABASE_URL = 'https://snapshot.test'
  const all = Array.from({ length: 1050 }, (_, i) => ({ ...sale,
    id: `snapshot-${i}`, twilio_sid: `SMsnapshot${i}`, direction: 'outbound' as const,
    to_number: `+1519555${String(i).padStart(4, '0')}`, body: `Moving ${i}`,
    created_at: new Date(Date.UTC(2026, 8, 9, 0, i)).toISOString(),
  }))
  let calls = 0
  globalThis.fetch = async input => {
    calls++
    const url = new URL(String(input))
    if (url.pathname.includes('market_touches')) return response([{ twilioSid: 'SMsnapshot1049' }])
    const offset = Number(url.searchParams.get('offset'))
    return response(all.slice(offset, offset + 1000))
  }
  try {
    const [a, b] = await Promise.all([listSmsThreadSummaryMessages(150), listSmsThreadSummaryMessages(150, 150)])
    assert.equal(buildSmsThreads(a, [], [], false).length, 150)
    assert.equal(buildSmsThreads(b, [], [], false).length, 150)
    assert.equal(calls, 3)
    const final = buildSmsThreads(await listSmsThreadSummaryMessages(150, 1000), [], [], false)
    assert.equal(final.length, 49)
    assert.equal(calls, 3)
  } finally { globalThis.fetch = originalFetch; process.env.SUPABASE_URL = oldUrl }
})

test('a signed SMS is not acknowledged or misrouted when ownership lookup fails', async () => {
  const { POST } = await import('../../app/api/sales/twilio/sms/route')
  const { createHmac } = await import('node:crypto')
  const oldToken = process.env.TWILIO_AUTH_TOKEN
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  const endpoint = 'https://example.test/api/sales/twilio/sms'
  const fields = { From: intro.to_number, To: intro.from_number, Body: 'My move is Friday', MessageSid: 'SMretry' }
  const signed = endpoint + Object.keys(fields).sort().map(key => key + fields[key as keyof typeof fields]).join('')
  const signature = createHmac('sha1', 'test-token').update(signed).digest('base64')
  let writes = 0
  globalThis.fetch = async (_input, options) => {
    if (options?.method && options.method !== 'GET') writes++
    return new Response('database unavailable', { status: 503 })
  }
  try {
    const result = await POST(new Request(endpoint, { method: 'POST',
      headers: { 'x-twilio-signature': signature }, body: new URLSearchParams(fields) }))
    assert.equal(result.status, 503)
    assert.equal(writes, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (oldToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
    else process.env.TWILIO_AUTH_TOKEN = oldToken
  }
})

test('a shared partner number on a later database page cannot select an arbitrary contact', async () => {
  const { notifyPartnershipCustomerContact } = await import('../../lib/server/partnership-inbound')
  let reads = 0
  globalThis.fetch = async (input, options) => {
    assert.ok(!options?.method || options.method === 'GET')
    reads++
    const offset = new URL(String(input)).searchParams.get('offset')
    return response(offset === '0'
      ? Array.from({ length: 200 }, (_, i) => ({ id: `contact-${i}`, phone: i === 0 ? '(519) 574-3499' : '+15195553499' }))
      : [{ id: 'shared-contact', phone: '519-574-3499' }])
  }
  try {
    assert.equal(await notifyPartnershipCustomerContact({ channel: 'sms', phone: intro.to_number }), false)
    assert.equal(reads, 2)
  } finally { globalThis.fetch = originalFetch }
})
