import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
export async function fixture() {
 const db = new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;create table crm_quotes(id text primary key,data jsonb not null,deleted boolean default false,updated_at timestamptz default now());create table crm_leads(id text primary key,data jsonb not null,deleted boolean default false,updated_at timestamptz default now());`)
 for (const name of ['20260916001000_direct_payment_operations.sql','20260916001200_checkout_collection_reservations.sql','20261023000100_durable_financial_commands.sql','20261023000200_internal_alert_outbox.sql']) await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'))
 await db.query('insert into crm_quotes(id,data) values ($1,$2)', ['q', {id:'q',leadId:'l',number:'Q1',total:1000,deposit:200,balance:800,revision:0,paymentRecords:[],depositStripePaymentMethodId:'pm_test',depositStripeCustomerId:'cus_test'}])
 await db.query('insert into crm_leads(id,data) values ($1,$2)', ['l',{id:'l',name:'Synthetic fixture',stage:'new',callLogs:[]}])
 return db
}
export const lease='00000000-0000-4000-8000-000000000001'
export async function reserve(db,key='operation-fixture-001',kind='charge-deposit:') {
 return (await db.query('select reserve_financial_command($1,$2,$3,$4,$5,$6,$7,$8,$9) as op',[key,'hash','q','l',kind,'saturn','test','actor',lease])).rows[0].op
}
test('financial commands serialize collections, reject changed requests, and replay completed operations', async()=>{
 const db=await fixture()
 try {
  const op=await reserve(db)
  await assert.rejects(()=>reserve(db,'operation-fixture-002'))
  await assert.rejects(()=>db.query('select reserve_financial_command($1,$2,$3,$4,$5,$6,$7,$8,$9)',[op.operation_key,'changed','q','l',op.kind,'saturn','test','actor',lease]))
  await db.query(`update crm_financial_commands set state='provider_returned',provider_result=$2 where id=$1`,[op.id,{id:'pi_test',status:'succeeded',amount_received:20000,currency:'cad',livemode:false}])
  const q=(await db.query(`select data from crm_quotes where id='q'`)).rows[0].data
  const args=[op.id,lease,0,{...q,depositPaidAmount:200,paymentRecords:[{id:'p',reference:'pi_test',amount:200}]},{paymentStatus:'deposit_received'}]
  const apply=()=>db.query('select apply_financial_projection($1,$2,$3,$4,$5) as result',args)
  await apply();await apply()
  assert.equal((await reserve(db)).state,'complete')
  assert.equal((await db.query(`select jsonb_array_length(data->'paymentRecords') as n from crm_quotes where id='q'`)).rows[0].n,1)
  await assert.rejects(()=>reserve(db,'operation-fixture-003'))
 } finally {await db.close()}
})
test('CRM projection is atomic when the lead update fails', async()=>{
 const db=await fixture()
 try {
  const op=await reserve(db)
  await db.query(`update crm_financial_commands set state='provider_returned',provider_result=$2 where id=$1`,[op.id,{id:'pi_test',status:'succeeded'}])
  await db.exec(`create function reject_lead() returns trigger language plpgsql as $$begin raise exception 'fixture write failure';end$$;create trigger reject_lead before update on crm_leads for each row execute function reject_lead();`)
  await assert.rejects(()=>db.query('select apply_financial_projection($1,$2,$3,$4,$5)',[op.id,lease,0,{id:'q',leadId:'l',depositPaidAmount:200},{paymentStatus:'deposit_received'}]))
  assert.equal((await db.query(`select data->>'depositPaidAmount' as paid from crm_quotes where id='q'`)).rows[0].paid,null)
  assert.equal((await db.query(`select state from crm_financial_commands where id=$1`,[op.id])).rows[0].state,'provider_returned')
 } finally {await db.close()}
})
test('customer checkout and staff collection cannot overlap, and untrusted roles cannot execute commands',async()=>{
 const db=await fixture()
 try {
  await db.query('select reserve_checkout_collection($1,$2,$3,$4,$5,$6,$7)',['q','l','saturn','test','hash','params',0])
  await assert.rejects(()=>reserve(db))
  await db.exec('set role authenticated')
  await assert.rejects(()=>reserve(db),/permission denied/)
  await db.exec('reset role')
 }finally{await db.close()}
})
test('contractor response and per-recipient alerts commit together; retries deduplicate jobs',async()=>{
 const db=await fixture()
 try{
  const row=(await db.query(`select updated_at::text as updated_at from crm_leads where id='l'`)).rows[0]
  const alert={subject:'Fixture',html:'Fixture',recipients:['one@example.test','two@example.test']}
  const args=['l',row.updated_at,[], 'event-one',alert]
  await db.query('select save_scope_reviews_with_alert($1,$2,$3,$4,$5)',args)
  await db.query('select enqueue_internal_alert($1,$2)',['event-one',alert])
  assert.equal((await db.query('select count(*)::int as n from crm_alert_outbox')).rows[0].n,2)
  await assert.rejects(()=>db.query('select save_scope_reviews_with_alert($1,$2,$3,$4,$5)',args))
  assert.equal((await db.query('select count(*)::int as n from crm_alert_outbox')).rows[0].n,2)
  assert.equal((await db.query('select * from claim_internal_alerts(10)')).rows.length,2)
  assert.equal((await db.query('select * from claim_internal_alerts(10)')).rows.length,0)
  await db.exec(`update crm_alert_outbox set updated_at=now()-interval '10 minutes';select * from claim_internal_alerts(10);`)
  assert.equal((await db.query(`select count(*)::int as n from crm_alert_outbox where state='unknown'`)).rows[0].n,2)
 }finally{await db.close()}
})
