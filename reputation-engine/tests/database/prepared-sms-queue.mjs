import test from 'node:test';import assert from 'node:assert/strict';import {preparedSmsDatabase} from '../helpers/prepared-sms-db.mjs';
test('atomic prepared enqueue, queue visibility, replay, suppression and reservation policy',async t=>{
 const db=await preparedSmsDatabase();try{
 const base={phone:'+15195551234',company:'Fixture Company',city:'Windsor',category:'property_management',sender:'+12267746581',body:'Hello from Saturn',execution_key:'a'.repeat(64),scheduled_at:new Date(Date.now()+86400000).toISOString()};
 const enqueue=async rows=>(await db.query("select enqueue_prepared_sms('campaign-fixture','Fixture',$1::jsonb,100) as result",[JSON.stringify(rows)])).rows[0].result;
 await assert.rejects(db.query("select enqueue_prepared_sms('rate-fixture','Fixture',$1::jsonb,1001)",[JSON.stringify([base])]),/Invalid prepared campaign/);
 const accepted=await db.query("select enqueue_prepared_sms('rate-fixture','Fixture',$1::jsonb,1000) as result",[JSON.stringify([base])]);assert.equal(accepted.rows[0].result.jobs.length,1);
 let jid;
 await t.test('send-ready inserts pending sequence job and linked company atomically',async()=>{const r=await enqueue([base]);jid=r.jobs[0].id;assert.equal(r.jobs[0].status,'pending');const q=await db.query("select j.*,c.partner_company_id from sequence_jobs j join market_contacts c on c.id=j.contact_id where status='pending'");assert.equal(q.rows.length,1);assert.ok(q.rows[0].partner_company_id);assert.equal(q.rows[0].sms_payload.body,base.body)});
 await t.test('same approved manifest retries without duplicate jobs',async()=>{const r=await enqueue([base]);assert.equal(r.jobs[0].id,jid);assert.equal(r.jobs[0].replay,true);assert.equal((await db.query('select * from sequence_jobs')).rows.length,1)});
 await t.test('changed content cannot reuse idempotency key',async()=>{await assert.rejects(enqueue([{...base,body:'Changed'}]),/content conflict/)});
 await t.test('another campaign key cannot queue same recipient again',async()=>{await assert.rejects(enqueue([{...base,execution_key:'b'.repeat(64)}]),/already queued/)});
 await t.test('late failure rolls back every insertion in transaction',async()=>{await assert.rejects(enqueue([{...base,phone:'+15195551235',company:'Other',execution_key:'c'.repeat(64)},{...base,phone:'bad',execution_key:'d'.repeat(64)}]));assert.equal((await db.query('select * from sequence_jobs')).rows.length,1);assert.equal((await db.query('select * from market_contacts')).rows.length,1)});
 await t.test('opt-out after preparation is rechecked at queue admission',async()=>{await db.exec("update sequence_jobs set status='cancelled';update market_contacts set do_not_contact=true");await assert.rejects(enqueue([{...base,execution_key:'e'.repeat(64)}]),/suppressed/);await db.exec('update market_contacts set do_not_contact=false')});
 const contact=(await db.query('select * from market_contacts')).rows[0];
 const reserve=async action=>(await db.query("select reserve_partnership_action($1,'sms','cold_introduction',$2,jsonb_build_object('observedAt',now(),'marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true)) as r",[contact.id,action])).rows[0].r;
 await t.test('worker policy reserves once; same key gets inspect-before-retry',async()=>{assert.equal((await reserve('sequence:'+jid)).allowed,true);assert.deepEqual((await reserve('sequence:'+jid)).reasons,['existing_reservation_inspect_before_retry'])});
 await t.test('new cold action for previously reserved contact gets outreach-review',async()=>{assert.ok((await reserve('sequence:another-action')).reasons.includes('existing_contact_outreach_review'))});
 await t.test('enqueue did not reserve a provider send or create an outbound touch',async()=>{assert.equal((await db.query('select * from market_touches')).rows.length,0);assert.equal((await db.query('select * from partnership_action_reservations')).rows.length,1)});
 }finally{await db.close()}
});
