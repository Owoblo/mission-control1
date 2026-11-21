import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {preparedSmsDatabase} from '../helpers/prepared-sms-db.mjs';
test('atomic inbound pause cancels pending jobs, preserves sent work, and is replayable',async()=>{
 const db=await preparedSmsDatabase();try{
 await db.exec('alter table market_contacts add column sequence_paused_reason text;alter table sequence_jobs add column error text');
 await db.exec(await readFile('supabase/migrations/20260926000400_pause_partnership_inbound.sql','utf8'));
 const c=(await db.query("insert into market_contacts(name,sequence_paused) values('Test',false) returning id")).rows[0];
 await db.query("insert into sequence_jobs(contact_id,status,channel) values($1,'pending','sms'),($1,'pending','email'),($1,'sent','sms')",[c.id]);
 const run=async()=> (await db.query("select pause_partnership_inbound($1,'sms') as r",[c.id])).rows[0].r;
 assert.equal((await run()).cancelled_pending,2);assert.equal((await run()).cancelled_pending,0);
 assert.equal((await db.query('select sequence_paused from market_contacts')).rows[0].sequence_paused,true);
 assert.equal((await db.query("select count(*)::int as n from sequence_jobs where status='sent'")).rows[0].n,1);
 await assert.rejects(db.query("select pause_partnership_inbound(gen_random_uuid(),'sms')"),/missing/);
 }finally{await db.close()}
});
