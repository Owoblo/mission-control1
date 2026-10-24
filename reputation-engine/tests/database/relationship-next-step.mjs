import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
const contact = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const eventId = '11111111-1111-4111-a111-111111111111'
const key = `relationship-material:${contact}:request:digital_card`
const task = { id: 'material-fixture', source_key: key, title: 'Review requested card', description: 'Original request reference', owner_name: 'Original owner', owner_user_id: 'owner', related_label: 'Fixture' }
function event(extra = {}) {
  return { id: eventId, action: 'next_step.create_task', actor_user_id: 'owner', actor_name: 'Owner', metadata: { original_contact_id: contact, insight_key: key, evidence_version: 'version-1', task_id: task.id }, ...extra }
}
async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE market_contacts(id uuid primary key, do_not_contact boolean default false, cross_channel_suppressed_at timestamptz, stage text);
    CREATE TABLE partner_activity_logs(id uuid primary key, contact_id uuid references market_contacts(id) on delete set null, action text not null,
      actor_user_id text, actor_name text, metadata jsonb not null, created_at timestamptz default now());`)
  for (const file of ['20260811130000_crm_tasks.sql','20261024000100_relationship_next_step_journal.sql']) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  await db.exec('GRANT SELECT,INSERT,UPDATE ON market_contacts,crm_tasks,partner_activity_logs TO service_role')
  await db.query('insert into market_contacts(id,stage) values($1,$2)', [contact, 'engaged'])
  const apply = (e = event(), t = task, mode = 'create', version = null) => db.query('select record_relationship_next_step($1,$2,$3,$4,$5) as result', [contact,e,t,mode,version])
  const count = async table => (await db.query(`select count(*)::int as n from ${table}`)).rows[0].n
  return { db, apply, count }
}
test('real PostgreSQL commits tasks and their explanations together, and an identical retry replays once', async () => {
  const f = await fixture()
  try {
    await f.db.exec('set role service_role')
    assert.equal((await f.apply()).rows[0].result.replayed, false)
    assert.equal((await f.apply()).rows[0].result.replayed, true)
    assert.equal(await f.count('crm_tasks'), 1); assert.equal(await f.count('partner_activity_logs'), 1)
    await assert.rejects(() => f.apply(event({ id: '22222222-2222-4222-a222-222222222222' })), /task already exists/)
    assert.equal(await f.count('partner_activity_logs'), 1)
    await assert.rejects(() => f.apply(event({ metadata: { ...event().metadata, evidence_version: 'changed' } })), /Conflicting/)
  } finally { await f.db.close() }
})
test('a database failure inserting history rolls back task creation and allows a safe retry', async () => {
  const f = await fixture()
  try {
    await f.db.exec(`CREATE FUNCTION fail_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Simulated history failure'; END$$;
      CREATE TRIGGER history_outage BEFORE INSERT ON partner_activity_logs FOR EACH ROW EXECUTE FUNCTION fail_history();`)
    await assert.rejects(() => f.apply(), /Simulated history failure/)
    assert.equal(await f.count('crm_tasks'), 0); assert.equal(await f.count('partner_activity_logs'), 0)
    await f.db.exec('drop trigger history_outage on partner_activity_logs')
    await f.apply(); assert.equal(await f.count('crm_tasks'), 1); assert.equal(await f.count('partner_activity_logs'), 1)
  } finally { await f.db.close() }
})
test('deferral checks the task version and preserves ownership; concurrent edits cannot be overwritten', async () => {
  const f = await fixture()
  try {
    await f.apply()
    const row = (await f.db.query('select updated_at::text as version from crm_tasks')).rows[0]
    const due = new Date(Date.now() + 86400000).toISOString()
    const e = event({ id: '22222222-2222-4222-a222-222222222222', action: 'next_step.defer' })
    await assert.rejects(() => f.apply(e, { ...task, due_at: due }, 'defer', '2020-01-01T00:00:00Z'), /Task changed/)
    assert.equal(await f.count('partner_activity_logs'), 1)
    await f.apply(e, { ...task, due_at: due }, 'defer', row.version)
    const current = (await f.db.query('select owner_name,owner_user_id,due_at,updated_at::text as version from crm_tasks')).rows[0]
    assert.equal(current.owner_name, 'Original owner'); assert.equal(current.owner_user_id, 'owner')
    assert.equal(new Date(current.due_at).toISOString(), due)
    await f.db.exec(`CREATE FUNCTION fail_deferral_history() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Simulated history failure'; END$$;
      CREATE TRIGGER deferral_outage BEFORE INSERT ON partner_activity_logs FOR EACH ROW EXECUTE FUNCTION fail_deferral_history();`)
    await assert.rejects(() => f.apply(event({ ...e, id: '33333333-3333-4333-a333-333333333333' }), { ...task, due_at: new Date(Date.now() + 172800000).toISOString() }, 'defer', current.version), /Simulated history failure/)
    assert.equal(new Date((await f.db.query('select due_at from crm_tasks')).rows[0].due_at).toISOString(), due)
    assert.equal(await f.count('partner_activity_logs'), 2)
    await f.db.exec('drop trigger deferral_outage on partner_activity_logs')
    await assert.rejects(() => f.apply(event({ ...e, id: '33333333-3333-4333-a333-333333333333' }), { ...task, due_at: due }, 'defer', row.version), /Task changed/)
  } finally { await f.db.close() }
})
test('new decision history rejects edits/deletes, supports correction events, and preserves contact deletion semantics', async () => {
  const f = await fixture()
  try {
    await f.apply()
    await assert.rejects(() => f.db.query('update partner_activity_logs set actor_name=$1', ['Changed']), /append-only/)
    await assert.rejects(() => f.db.exec('delete from partner_activity_logs'), /append-only/)
    await f.apply(event({ id: '22222222-2222-4222-a222-222222222222', action: 'next_step.corrected' }), null, 'none')
    assert.equal(await f.count('partner_activity_logs'), 2)
    await f.db.query('insert into partner_activity_logs(id,contact_id,action,metadata) values($1,$2,$3,$4)', ['33333333-3333-4333-a333-333333333333',contact,'legacy.action',{}])
    await f.db.exec("update partner_activity_logs set actor_name='Legacy edit' where action='legacy.action'; delete from partner_activity_logs where action='legacy.action'")
    await f.db.query('delete from market_contacts where id=$1', [contact])
    const rows = (await f.db.query('select contact_id,metadata from partner_activity_logs')).rows
    assert.ok(rows.every(r => r.contact_id === null && r.metadata.original_contact_id === contact))
  } finally { await f.db.close() }
})
test('untrusted roles cannot call the command; changed suppression blocks task creation without partial history', async () => {
  const f = await fixture()
  try {
    await f.db.exec('set role authenticated')
    await assert.rejects(() => f.apply(), /permission denied/)
    await f.db.exec('reset role')
    await f.db.query('update market_contacts set do_not_contact=true where id=$1', [contact])
    await assert.rejects(() => f.apply(), /Contact restrictions changed/)
    assert.equal(await f.count('crm_tasks'), 0); assert.equal(await f.count('partner_activity_logs'), 0)
  } finally { await f.db.close() }
})
test('normal task completion, corrections and reopening retain distinct immutable outcomes without claiming delivery', async () => {
  const f = await fixture()
  try {
    await f.apply()
    await f.db.exec("update crm_tasks set status='completed',outcome_note='Handled outside CRM',completed_by_name='Fixture rep',completed_at=now()")
    await f.db.exec("update crm_tasks set outcome_note='Correction: recipient confirmation still needed'")
    await f.db.exec("update crm_tasks set status='open',completed_at=null")
    const rows = (await f.db.query("select actor_name,metadata from partner_activity_logs where action='next_step.task_outcome_recorded' order by created_at,id")).rows
    assert.equal(rows.length, 3)
    assert.ok(rows.some(r => r.metadata.outcome === 'Handled outside CRM'))
    assert.ok(rows.some(r => r.metadata.previous_outcome === 'Handled outside CRM' && r.metadata.outcome.startsWith('Correction:')))
    assert.ok(rows.some(r => r.metadata.status === 'open' && r.actor_name === null), 'Reopening is not misattributed to the prior completer')
    assert.ok(rows.every(r => r.metadata.delivery_verified === false && r.metadata.outbound_sent === false))
    await assert.rejects(() => f.db.exec("delete from partner_activity_logs where action='next_step.task_outcome_recorded'"), /append-only/)
  } finally { await f.db.close() }
})
