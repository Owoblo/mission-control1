import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fixture } from './conversation-integrity.mjs'

async function alertsFixture() {
  const db = await fixture()
  await db.exec(`create table app_users(id text primary key,email text,role text,branch text);
    insert into app_users values ('manager','manager@example.test','manager',null),('rep','rep@example.test','sales_rep',null),('ottawa','ottawa@example.test','manager','ottawa'),('crew','crew@example.test','crew',null);`)
  await db.exec(await readFile(new URL('../../supabase/migrations/20261026000100_sales_alert_recipients.sql', import.meta.url), 'utf8'))
  return db
}
test('new web enquiries alert every eligible sales rep once and preserve quiet health checks', async () => {
  const db = await alertsFixture()
  try {
    const insert = (id, raw) => db.query('insert into inbound_leads(id,source,name,raw_data) values($1,$2,$3,$4)', [id,'website_form','Customer',raw])
    await insert('00000000-0000-4000-8000-000000000001', { inquiry_id: 'enquiry' })
    await insert('00000000-0000-4000-8000-000000000002', { inquiry_id: 'enquiry' })
    await insert('00000000-0000-4000-8000-000000000003', { healthCheck: true })
    const recipients = (await db.query("select payload->>'to' recipient from crm_alert_outbox order by recipient")).rows.map(row => row.recipient)
    assert.deepEqual(recipients, ['business@starmovers.ca','manager@example.test','rep@example.test'])
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select crm_sales_alert_recipients(null)'), /permission denied/)
  } finally { await db.close() }
})
test('branch routing includes the appropriate manager without notifying other branch managers', async () => {
  const db = await alertsFixture()
  try {
    const recipients = (await db.query('select crm_sales_alert_recipients($1) recipients',['ottawa'])).rows[0].recipients
    assert.ok(recipients.includes('ottawa@example.test')); assert.ok(!recipients.includes('crew@example.test'))
    assert.ok(!(await db.query('select crm_sales_alert_recipients($1) recipients',['toronto'])).rows[0].recipients.includes('ottawa@example.test'))
  } finally { await db.close() }
})
test('delivery failures also alert the complete sales roster', async () => {
  const db = await alertsFixture()
  try {
    await db.query('insert into sms_messages(id,twilio_sid,lead_id,direction) values($1,$2,$3,$4)',['sms','telnyx:message','lead','outbound'])
    await db.query('insert into crm_sms_provider_events(event_id,provider,provider_message_id,message_key,event_type,status,occurred_at,payload) values($1,$2,$3,$4,$5,$6,now(),$7)',['failure','telnyx','message','telnyx:message','message.finalized','delivery_failed',{}])
    assert.equal((await db.query('select count(*)::int n from crm_alert_outbox')).rows[0].n,3)
    assert.equal((await db.query('select count(*)::int n from crm_tasks')).rows[0].n,1)
  } finally { await db.close() }
})
