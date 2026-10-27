import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const sql=await fs.readFile('supabase/migrations/20261027000100_email_delivery_foundation.sql','utf8')
async function fixture(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create table market_contacts(id uuid primary key default gen_random_uuid(),email text,do_not_contact boolean default false,cross_channel_suppressed_at timestamptz,email_unsubscribed_at timestamptz,email_status text,sequence_paused boolean,sequence_paused_reason text);create table sequence_jobs(id uuid primary key default gen_random_uuid(),contact_id uuid,status text,error text);`);await db.exec(sql);await db.exec(await fs.readFile('supabase/migrations/20261027000200_email_dispatch_freshness.sql','utf8'));return db}
const body=(purpose='transactional',from='business@starmovers.ca',to=['client@example.test'])=>({purpose,from,domain:from.split('@')[1],recipients:to,subject:'A useful message',replyTo:'business@starmovers.ca',context:{source:'fixture'},unsubscribeHash:'a'.repeat(64)})
const reserve=async(db,key,payload=body(),fingerprint='a'.repeat(64))=>(await db.query('select reserve_crm_email($1,$2,$3) as result',[key,fingerprint,payload])).rows[0].result
const start=async(db,id)=>(await db.query('select start_crm_email($1,$2) as result',[id,'b'.repeat(64)])).rows[0].result
const finish=(db,id,state,message=null)=>db.query('select finish_crm_email($1,$2,$3,$4)',[id,state,message,null])
async function ready(db,cap=50){await db.exec(`update crm_email_domains set status='warming',daily_cap=${cap},minimum_interval_seconds=1,health='{"ready":true}',checked_at=now(),postal_address='123 Example Street, Windsor, ON, Canada' where purpose='outreach';update email_sender_accounts set status='warming';insert into crm_email_provider_health values('us-east-2','{"sendingEnabled":true,"production":true,"enforcement":"HEALTHY","max24HourSend":50000,"sentLast24Hours":0}',now());`)}
test('email transport reserves before dispatch, claims once, and returns the accepted receipt on replay',async()=>{const db=await fixture();try{
 const r=await reserve(db,'first');assert.equal(r.allowed,true);const again=await reserve(db,'first');assert.equal(again.attemptId,r.attemptId)
 assert.equal(await start(db,r.attemptId),true);assert.equal(await start(db,r.attemptId),false)
 const held=await reserve(db,'first');assert.equal(held.reason,'outcome_unknown')
 await finish(db,r.attemptId,'accepted','provider-1');const sent=await reserve(db,'first');assert.equal(sent.allowed,false);assert.equal(sent.accepted,true);assert.equal(sent.messageId,'provider-1')
 await assert.rejects(reserve(db,'first',body(),'b'.repeat(64)),/different content/)
 assert.equal((await db.query('select count(*)::int as n from crm_email_attempts')).rows[0].n,1)
 await assert.rejects(db.exec("update crm_email_requests set subject='Changed'"),/immutable/)
 await assert.rejects(db.exec('delete from crm_email_requests'),/immutable/)
}finally{await db.close()}})
test('only an explicit rejection permits another transport attempt; unknown outcomes stay held',async()=>{const db=await fixture();try{
 const r=await reserve(db,'retry');await start(db,r.attemptId);await finish(db,r.attemptId,'rejected');const retry=await reserve(db,'retry');assert.notEqual(retry.attemptId,r.attemptId)
 await start(db,retry.attemptId);await finish(db,retry.attemptId,'unknown');assert.equal((await reserve(db,'retry')).allowed,false)
 assert.equal((await db.query('select count(*)::int as n from crm_email_attempts')).rows[0].n,2)
}finally{await db.close()}})
test('aliases share their domain budget and account operational reserve, and start disabled',async()=>{const db=await fixture();try{
 const outreach=body('outreach','john@saturnstarmovers.ca');await assert.rejects(reserve(db,'disabled',outreach),/not enabled/)
 await ready(db,1);const first=await reserve(db,'one',outreach);assert.equal(first.allowed,true)
 await db.exec("update crm_email_domains set next_send_at=now()-interval '1 minute'")
 await assert.rejects(reserve(db,'second',body('outreach','jo@saturnstarmovers.ca')),/shared domain limit/)
 await db.exec("update crm_email_domains set daily_cap=50;update crm_email_provider_health set snapshot=jsonb_set(snapshot,'{sentLast24Hours}','49000')")
 await assert.rejects(reserve(db,'account-reserve',body('outreach','jo@saturnstarmovers.ca')),/operational reserve/)
 assert.equal((await db.query('select count(*)::int as n from crm_email_attempts')).rows[0].n,1)
}finally{await db.close()}})
test('missing/stale health, suppression, multi-recipient outreach and a pause before dispatch prevent release',async()=>{const db=await fixture();try{
 await ready(db);const outreach=body('outreach','john@saturnstarmovers.ca')
 await db.exec("update crm_email_domains set health='{}'");await assert.rejects(reserve(db,'null-health',outreach),/health/)
 await db.exec("update crm_email_domains set health='{"+'"ready":true'+"}',checked_at=now()-interval '2 hours'");await assert.rejects(reserve(db,'stale',outreach),/health/)
 await db.exec("update crm_email_domains set checked_at=now();insert into market_contacts(email,do_not_contact) values('client@example.test',true)")
 await assert.rejects(reserve(db,'suppressed',outreach),/suppressed/)
 await db.exec('delete from market_contacts');await assert.rejects(reserve(db,'many',body('outreach','john@saturnstarmovers.ca',['a@example.test','b@example.test'])),/one recipient/)
 const r=await reserve(db,'pause',outreach);await db.exec("update email_sender_accounts set status='paused'");await assert.rejects(start(db,r.attemptId),/paused/)
}finally{await db.close()}})
test('signed provider evidence reconciles unknown results by attempt, sender, subject and recipient; receipts are immutable and per recipient',async()=>{const db=await fixture();try{
 const payload=body('transactional','business@starmovers.ca',['a@example.test','b@example.test']);const r=await reserve(db,'multi',payload);await start(db,r.attemptId);await finish(db,r.attemptId,'unknown')
 const event={eventKey:'first',messageId:'provider-1',recipient:'a@example.test',eventType:'email_provider_accepted',sentAt:new Date().toISOString(),occurredAt:new Date().toISOString(),from:payload.from,domain:payload.domain,subject:payload.subject,attemptId:r.attemptId}
 await db.query('select record_crm_email_receipt($1)',[{...event,eventKey:'wrong',recipient:'someone-else@example.test'}]);assert.equal((await reserve(db,'multi',payload)).allowed,false)
 await db.query('select record_crm_email_receipt($1)',[event]);await db.query('select record_crm_email_receipt($1)',[event]);await db.query('select record_crm_email_receipt($1)',[{...event,eventKey:'second',recipient:'b@example.test'}])
 assert.equal((await reserve(db,'multi',payload)).accepted,true)
 assert.equal((await db.query("select count(*)::int as n from crm_email_receipts where attempt_id is not null")).rows[0].n,2)
 await assert.rejects(db.exec("update crm_email_receipts set recipient='other@example.test'"),/immutable/)
 const report=(await db.query('select crm_email_foundation_report() as report')).rows[0].report;assert.equal(report.counts.recordedRecipientSends,3)
}finally{await db.close()}})
test('one-click unsubscribe is idempotent, cancels pending outreach, and prevents dispatch after reservation',async()=>{const db=await fixture();try{
 await ready(db);const r=await reserve(db,'unsubscribe',body('outreach','john@saturnstarmovers.ca'))
 await db.exec("insert into market_contacts(email) values('client@example.test');insert into sequence_jobs(contact_id,status) select id,'pending' from market_contacts")
 assert.equal((await db.query('select unsubscribe_crm_email($1) as result',['a'.repeat(64)])).rows[0].result,true)
 await db.query('select unsubscribe_crm_email($1)',['a'.repeat(64)])
 assert.equal((await db.query('select count(*)::int as n from crm_email_suppressions')).rows[0].n,1)
 assert.equal((await db.query('select status from sequence_jobs')).rows[0].status,'cancelled')
 await assert.rejects(start(db,r.attemptId),/opted out/)
 assert.equal((await db.query('select unsubscribe_crm_email($1) as result',['b'.repeat(64)])).rows[0].result,false)
}finally{await db.close()}})
test('email evidence and transport commands are inaccessible to anonymous and ordinary authenticated roles',async()=>{const db=await fixture();try{
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("select has_function_privilege($1,'reserve_crm_email(text,text,jsonb)','execute') as yes",[role])).rows[0].yes,false)
  assert.equal((await db.query("select has_table_privilege($1,'crm_email_requests','select') as yes",[role])).rows[0].yes,false)
 }
 assert.equal((await db.query("select has_function_privilege('service_role','reserve_crm_email(text,text,jsonb)','execute') as yes")).rows[0].yes,true)
}finally{await db.close()}})
test('a verified complaint pauses the shared outreach domain and aliases once; replay cannot undo an owner review',async()=>{const db=await fixture();try{
 await ready(db)
 const event={eventKey:'complaint-one',messageId:'provider-complaint',recipient:'client@example.test',eventType:'email_complained',sentAt:new Date().toISOString(),occurredAt:new Date().toISOString(),from:'john@saturnstarmovers.ca',domain:'saturnstarmovers.ca',subject:'A message'}
 await db.query('select record_crm_email_receipt($1)',[event])
 assert.equal((await db.query("select status from crm_email_domains where purpose='outreach'")).rows[0].status,'paused')
 assert.equal((await db.query("select count(*)::int as n from email_sender_accounts where status='paused'")).rows[0].n,2)
 await db.exec("update crm_email_domains set status='warming';update email_sender_accounts set status='warming'")
 await db.query('select record_crm_email_receipt($1)',[event])
 assert.equal((await db.query("select status from crm_email_domains where purpose='outreach'")).rows[0].status,'warming')
}finally{await db.close()}})

test('prepared outreach cannot dispatch after its review or provider health has expired',async()=>{const db=await fixture();try{
 await ready(db);const r=await reserve(db,'freshness',body('outreach','john@saturnstarmovers.ca'))
 await db.exec("update crm_email_provider_health set checked_at=now()-interval '16 minutes'");await assert.rejects(start(db,r.attemptId),/account health expired/)
 await db.exec("update crm_email_provider_health set checked_at=now();update crm_email_attempts set created_at=now()-interval '6 minutes'");await assert.rejects(start(db,r.attemptId),/reservation expired/)
 assert.equal((await db.query('select state from crm_email_attempts')).rows[0].state,'prepared')
}finally{await db.close()}})
