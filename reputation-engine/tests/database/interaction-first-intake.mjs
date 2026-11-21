import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('interaction history, qualification, promotion and corrections', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table crm_leads(id text primary key,data jsonb not null,updated_at timestamptz default now(),deleted boolean default false);
      create table inbound_leads(id text primary key,source text,phone text,email text,message text,created_at timestamptz default now());
      insert into crm_leads(id,data) values ('legacy','{"id":"legacy","stage":"booked","name":"Employee"}');`)
    await db.exec(await readFile('supabase/migrations/20260924000100_interaction_first_intake.sql', 'utf8'))
    assert.equal((await db.query(`select data->>'commercialDisposition' as state from crm_leads where id='legacy'`)).rows[0].state, 'lead_candidate')
    const initial = { actor: 'unknown', intent: 'unknown', disposition: 'lead_candidate', confidence: 0, reason: 'Review needed' }
    const event = { sender: '+15195550123', source: 'sms', channel: 'sms', body: 'Move quote please', raw: 'original bytes' }
    await db.query('select capture_crm_interaction($1,$2,$3)', ['sms1', event, initial])
    await db.query('select capture_crm_interaction($1,$2,$3)', ['sms1', { ...event, raw: 'retry changed' }, initial])
    assert.equal((await db.query(`select count(*)::int as n from crm_interaction_classifications where interaction_id='sms1'`)).rows[0].n, 1)
    assert.equal((await db.query(`select event->>'raw' as raw from crm_interactions where id='sms1'`)).rows[0].raw, 'original bytes')
    const revision = (await db.query(`select id from crm_interaction_classifications where interaction_id='sms1'`)).rows[0].id
    const qualified = { actor: 'prospect', intent: 'quote_request', disposition: 'qualified_lead', confidence: 1, reason: 'Verified by conversation' }
    const review = (classification, expected = revision, promote = true) => db.query('select review_crm_interaction($1,$2,$3,$4,$5) as result', ['sms1', expected, classification, 'john', promote])
    await assert.rejects(review(qualified), /qualification evidence/)
    await assert.rejects(review(initial), /verified opportunities/)
    qualified.evidence = { movingIntent: true, serviceableLocation: true, realIdentity: true, usableContact: true, plausibleOpportunity: true, location: 'Windsor, ON' }
    const result = (await review(qualified)).rows[0].result
    assert.ok(result.leadId)
    assert.equal((await db.query('select count(*)::int as n from crm_leads')).rows[0].n, 2)
    await assert.rejects(review(qualified), /Classification changed/)
    await db.query('select capture_crm_interaction($1,$2,$3)', ['sms2', { ...event, occurredAt: '2026-09-24T15:00:00Z', body: 'Thanks' }, initial])
    const linked = (await db.query('select data from crm_leads where id=$1', [result.leadId])).rows[0].data
    assert.equal(linked.commercialDisposition, 'qualified_lead', 'a new unknown interaction cannot undo qualification')
    assert.equal(linked.interactionProvenance.convertingTouch, 'sms1')
    assert.ok(linked.interactionProvenance.latestTouch)

    const corrected = { actor: 'employee', intent: 'employee_internal', disposition: 'not_a_lead', confidence: 1, reason: 'Internal operations call' }
    await review(corrected, result.id, false)
    await db.query(`update crm_leads set data=data||'{"commercialDisposition":"qualified_lead"}' where id=$1`, [result.leadId])
    const record = (await db.query('select data from crm_leads where id=$1', [result.leadId])).rows[0].data
    assert.equal(record.commercialDisposition, 'not_a_lead')
    assert.equal((await db.query(`select count(*)::int as n from crm_interaction_classifications where interaction_id='sms1'`)).rows[0].n, 3)
    await assert.rejects(db.exec("update crm_interactions set event='{}' where id='sms1'"), /append-only/)
    await assert.rejects(db.exec("delete from crm_interaction_classifications where interaction_id='sms1'"), /append-only/)
    await db.exec("insert into inbound_leads(id,source,message) values('form1','website_form','hello')")
    assert.equal((await db.query("select count(*)::int as n from crm_interactions where id like 'inbound:form1:%'")).rows[0].n, 1)
  } finally { await db.close() }
})
