import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(pathToFileURL(process.env.SSM_PGLITE_MODULE || '/private/tmp/ssm-phase0-db-test/node_modules/@electric-sql/pglite/dist/index.js').href)

test('Payment operations execute against PostgreSQL, including atomic failure and repeat handling', async t => {
 const db = new PGlite()
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table crm_quotes(id text primary key,data jsonb not null,updated_at timestamptz default now(),deleted boolean default false);
    create table crm_leads(id text primary key,data jsonb not null,updated_at timestamptz default now(),deleted boolean default false);`)
  await db.exec(await readFile('supabase/migrations/20260916001000_direct_payment_operations.sql','utf8'))
  await db.exec(await readFile('supabase/migrations/20260916001200_checkout_collection_reservations.sql','utf8'))
  async function seed(id) {
   await db.query('insert into crm_leads(id,data) values($1,$2)',[id,JSON.stringify({id,paymentStatus:'pending',stage:'booked',importantNote:'preserve'})])
   await db.query('insert into crm_quotes(id,data) values($1,$2)',[id,JSON.stringify({id,leadId:id,revision:0,total:1000,deposit:250,balance:1000,paymentRecords:[]})])
  }
  async function reserve(id,key='command-key-00000001',amount=25000,revision=0,hash='hash') {
   return (await db.query('select reserve_direct_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',[key,'saturn','test',hash,id,id,'deposit',amount,revision,'staff'])).rows[0].result
  }
  async function apply(op,reference) {
   return (await db.query('select apply_direct_payment($1,$2,$3,$4) as result',[op.id,JSON.stringify({id:'payment-'+op.id,amount:op.amount_minor/100,reference,kind:'deposit'}),'visa','4242'])).rows[0].result
  }
  await t.test('Retries return the same operation and conflicting input is rejected',async()=>{
   await seed('a'); const a=await reserve('a');const b=await reserve('a')
   assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(a.operation.id,b.operation.id)
   await assert.rejects(reserve('a','command-key-00000001',26000,0,'changed'),/inputs changed/)
   await assert.rejects(reserve('a','command-key-00000002'),/requires reconciliation/)
  })
  await t.test('No collection for stale revision or amount beyond balance',async()=>{
   await seed('b');await assert.rejects(reserve('b','command-key-00000003',100001),/exceeds/)
   await assert.rejects(reserve('b','command-key-00000003',25000,1),/Quote changed/)
  })
  await t.test('Unverified provider outcome cannot be applied',async()=>{
   const op=(await reserve('a')).operation
   await assert.rejects(apply(op,'pi_a'),/Verified successful/)
  })
  await t.test('Atomic apply preserves unrelated fields and repeat cannot allocate twice',async()=>{
   const op=(await reserve('a')).operation
   await db.query("update crm_payment_operations set state='provider_succeeded',provider_intent_id='pi_a' where id=$1",[op.id])
   const first=await apply(op,'pi_a'); const second=await apply(op,'pi_a')
   assert.equal(first.replayed,false); assert.equal(second.replayed,true)
   assert.equal(second.quote.paymentRecords.length,1);assert.equal(second.quote.balance,750)
   assert.equal(second.lead.importantNote,'preserve');assert.equal(second.lead.stage,'booked')
   assert.equal(second.lead.paymentStatus,'deposit_received')
   await assert.rejects(reserve('a','command-key-00000004',25000,1),/Deposit already/)
  })
  await t.test('Projection failure rolls back quote, lead, operation and event together',async()=>{
   await seed('c');const op=(await reserve('c','command-key-00000005')).operation
   await db.query("update crm_payment_operations set state='provider_succeeded',provider_intent_id='pi_c' where id=$1",[op.id])
   await db.exec("create function fail_test_update() returns trigger language plpgsql as $$ begin if new.id='c' then raise exception 'injected storage failure'; end if; return new; end $$; create trigger test_failure before update on crm_leads for each row execute function fail_test_update();")
   await assert.rejects(apply(op,'pi_c'),/injected storage failure/)
   const quote=(await db.query("select data from crm_quotes where id='c'")).rows[0].data
   assert.equal(quote.paymentRecords.length,0)
   assert.equal((await db.query('select state from crm_payment_operations where id=$1',[op.id])).rows[0].state,'provider_succeeded')
   await db.exec('drop trigger test_failure on crm_leads')
   assert.equal((await apply(op,'pi_c')).quote.paymentRecords.length,1)
  })
  await t.test('Customer checkout and staff collection cannot reserve the same quote',async()=>{
   await seed('checkout')
   const params=['checkout','checkout','saturn','test','checkout-hash','mode=payment',0]
   const first=(await db.query('select reserve_checkout_collection($1,$2,$3,$4,$5,$6,$7) as op',params)).rows[0].op
   const again=(await db.query('select reserve_checkout_collection($1,$2,$3,$4,$5,$6,$7) as op',params)).rows[0].op
   assert.equal(first.id,again.id)
   await assert.rejects(reserve('checkout','command-key-00000006'),/checkout is pending/)
   await assert.rejects(db.query('select reserve_checkout_collection($1,$2,$3,$4,$5,$6,$7)',[...params.slice(0,4),'changed','mode=payment',0]),/different checkout/)
   await db.query("update crm_checkout_operations set state='expired' where id=$1",[first.id])
   assert.equal((await reserve('checkout','command-key-00000006')).created,true)
   await assert.rejects(db.query('select reserve_checkout_collection($1,$2,$3,$4,$5,$6,$7)',params),/awaiting reconciliation/)
  })
  await t.test('Paid accepted quote confirms sales while leaving resource assignment unchanged',async()=>{
   await seed('new-booking')
   await db.query("update crm_leads set data=data || $1::jsonb where id='new-booking'",[JSON.stringify({stage:"tentative"})])
   await db.query("update crm_quotes set data=data || $1::jsonb where id='new-booking'",[JSON.stringify({status:"accepted"})])
   const op=(await reserve('new-booking','command-key-00000007')).operation
   await db.query("update crm_payment_operations set state='provider_succeeded',provider_intent_id='pi_booking' where id=$1",[op.id])
   const result=await apply(op,'pi_booking')
   assert.equal(result.lead.stage,'booked');assert.equal(result.lead.assignedCrew,undefined)
  })
  await t.test('Event history and RPC entry points reject unauthorized mutation',async()=>{
   await assert.rejects(db.exec('update crm_payment_operation_events set event_type=\'changed\''),/append-only/)
   await db.exec('set role authenticated')
   try { await assert.rejects(reserve('a'),/permission denied/) } finally {await db.exec('reset role')}
  })
 } finally { await db.close() }
})
