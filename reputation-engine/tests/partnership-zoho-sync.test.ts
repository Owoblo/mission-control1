import test from 'node:test'
import assert from 'node:assert/strict'
import { syncPartnershipZohoReplies } from '../lib/server/partnership-zoho-sync'

test('mailbox import retries failed alerts without duplicate touches or false human replies', async () => {
  const oldFetch = global.fetch, oldNow = Date.now
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_KEY: 'fake', ZOHO_PARTNERSHIP_CLIENT_ID: 'fake', ZOHO_PARTNERSHIP_CLIENT_SECRET: 'fake', ZOHO_PARTNERSHIP_REFRESH_TOKEN: 'fake', ZOHO_PARTNERSHIP_ACCOUNTS_URL: 'https://accounts.zohocloud.ca', ZOHO_PARTNERSHIP_MAIL_URL: 'https://mail.zohocloud.ca', PARTNERSHIP_EMAIL_REPLY_TO: 'business@starmovers.ca' }
  const prior = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  Date.now = () => Date.parse('2026-09-16T12:00:00Z')
  const contacts = [{ id: 'c1', name: 'Purchasing', company: 'City', city: 'Windsor', email: 'purchasing@example.test', email_last_sent_at: '2026-09-15T19:16:00Z' }, { id: 'c2', name: 'Info', company: 'Innomation', city: 'Windsor', email: 'info@example.test', email_last_sent_at: '2026-09-15T19:16:00Z' }]
  contacts.push({ id: 'c3', name: 'Owner', company: 'Example', city: 'Windsor', email: 'owner@example.test', email_last_sent_at: '2026-09-15T19:16:00Z' })
  const latest = new Map<string, string>()
  const cancelled: Record<string, any>[] = []
  const rows = contacts.map((c, i) => ({ messageId: 'm' + i, folderId: 'f', fromAddress: c.email, subject: i === 1 ? 'Your email requires verification verify#123' : 'RE: Moving support', receivedTime: String(Date.parse('2026-09-15T20:00:00Z')) }))
  const spamRows: typeof rows = []
  const touches = new Map<string, Record<string, any>>()
  const patches: Record<string, any>[] = []
  let fail = true, notifications = 0
  global.fetch = (async (input, init) => {
    const u = new URL(String(input)), method = init?.method || 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    if (u.hostname === 'accounts.zohocloud.ca') return Response.json({ access_token: 'fake' })
    if (u.hostname === 'mail.zohocloud.ca') {
      let data: unknown = []
      if (u.pathname === '/api/accounts') data = [{ accountId: 'a', primaryEmailAddress: 'business@starmovers.ca' }]
      else if (u.pathname.endsWith('/folders')) data = [{folderId:'spam',folderType:'Spam'}]
      else if (u.pathname.endsWith('/messages/view')) data = u.searchParams.get('folderId') === 'spam' ? spamRows : rows
      else if (u.pathname.endsWith('/header')) data = { headerContent: 'Message-ID: <reply@example.test>\r\n' }
      else if (u.pathname.endsWith('/content')) data = { content: u.pathname.includes('m0') ? '<p>Please reach out to Facility Department.</p><div>From: John</div><p>Original message</p>' : u.pathname.includes('m2') ? '<p>No thanks.</p><p>Kind regards,</p><p>Jane Smith</p>' : '<p>Verify that you are a real live human. Leslie will manually review it.</p>' }
      return Response.json({ status: { code: 200 }, data })
    }
    if (u.hostname === 'db.test') {
      if (u.pathname.endsWith('/rpc/enqueue_internal_alert')) {
        assert.match(body.p_event, /^partner-event:/)
        if (fail) { fail = false; return Response.json({error:'temporary'}, {status:503}) }
        notifications++; return Response.json({id:'alert'})
      }
      if (u.pathname.endsWith('/email_provider_events')) return Response.json([])
      if (u.pathname.endsWith('/market_contacts')) {
        if (method === 'PATCH') {
          const id = u.searchParams.get('id')!.slice(3)
          patches.push({ id: 'eq.' + id, ...body })
          if (body.last_inbound_at && (!u.searchParams.has('or') || !latest.has(id) || latest.get(id)! < body.last_inbound_at)) latest.set(id, body.last_inbound_at)
          return Response.json([])
        }
        return Response.json(contacts.map(c => ({ ...c, last_inbound_at: latest.get(c.id) })))
      }
      if (u.pathname.endsWith('/sequence_jobs')) { cancelled.push({ contact_id: u.searchParams.get('contact_id'), status_filter: u.searchParams.get('status'), ...body }); return Response.json([]) }
      if (u.pathname.endsWith('/market_touches')) {
        if (method === 'POST') { touches.set(body.id, body); return Response.json([body]) }
        const id = u.searchParams.get('id')?.slice(3), row = id ? touches.get(id) : undefined
        if (method === 'PATCH') { Object.assign(row!, body); return Response.json([row]) }
        const ids = u.searchParams.get('id')
        return Response.json(ids?.startsWith('in.(') ? [...touches.values()].filter(t => ids.includes(t.id)) : row ? [row] : [])
      }
    }
    throw Error('Unexpected request ' + u)
  }) as typeof fetch
  try {
    await assert.rejects(syncPartnershipZohoReplies(), /Internal alert delivery storage unavailable/)
    assert.equal(touches.size, 1)
    assert.equal((await syncPartnershipZohoReplies()).alerted, 3)
    assert.equal(touches.size, 3)
    const repeat = await syncPartnershipZohoReplies()
    assert.equal(repeat.imported, 0); assert.equal(repeat.alerted, 0); assert.equal(notifications, 3)
    const records = [...touches.values()]
    assert.ok(records[0].notes.includes('Original message'))
    assert.equal(records[0].metadata.human_reply, true)
    assert.equal(records[1].metadata.human_reply, false)
    assert.equal(records[1].metadata.email_kind, 'verification')
    assert.ok(patches.filter(p => p.id === 'eq.c2').every(p => !p.last_inbound_at))
    assert.equal(records[2].metadata.email_kind, 'opt_out')
    const suppressed = patches.find(p => p.id === 'eq.c3')
    assert.ok(suppressed)
    assert.equal(suppressed.do_not_contact, true)
    assert.equal(suppressed.email_status, 'unsubscribed')
    assert.equal(suppressed.cross_channel_suppression_reason, 'email_opt_out')
    assert.ok(suppressed.email_unsubscribed_at)
    assert.ok(cancelled.some(p => p.contact_id === 'eq.c3' && p.status_filter === 'eq.pending' && p.status === 'cancelled'))
    // Multiple replies for one contact arrive newest first in a single scan.
    rows.unshift({ ...rows[0], messageId: 'm0-new', receivedTime: String(Date.parse('2026-09-15T22:00:00Z')) })
    rows.push({ ...rows[0], messageId: 'm0-older', receivedTime: String(Date.parse('2026-09-15T21:00:00Z')) })
    assert.equal((await syncPartnershipZohoReplies()).imported, 2)
    assert.equal(latest.get('c1'), '2026-09-15T22:00:00.000Z')
    spamRows.push({ ...rows[0], folderId: 'spam', messageId: 'm0-spam', receivedTime: String(Date.parse('2026-09-15T23:00:00Z')) })
    assert.equal((await syncPartnershipZohoReplies()).imported, 1)
    const spamTouch = [...touches.values()].find(t => t.metadata.zoho_message_id === 'm0-spam')!
    assert.equal(spamTouch.metadata.found_in_spam, true)
    assert.equal(spamTouch.metadata.zoho_folder_id, 'spam')
    assert.equal(latest.get('c1'), '2026-09-15T23:00:00.000Z')
    assert.equal((await syncPartnershipZohoReplies()).imported, 0)
  } finally {
    global.fetch = oldFetch; Date.now = oldNow
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})
