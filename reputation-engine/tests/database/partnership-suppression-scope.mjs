import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.SSM_PGLITE_MODULE ? pathToFileURL(process.env.SSM_PGLITE_MODULE).href : '@electric-sql/pglite');
test('Partnership suppression follows the recipient, with explicit company policy preserved',async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table partner_companies(id uuid primary key);
 create table market_contacts(id uuid primary key,partner_company_id uuid,phone text,email text,do_not_contact boolean,stage text,decision text,last_inbound_at timestamptz,cross_channel_suppressed_at timestamptz);
 create table market_touches(contact_id uuid,direction text,created_at timestamptz);
 create table crm_tasks(status text,related_type text,related_id text);
 create table partner_referrals(company_id uuid,job_id text,job_status text);`);
 await db.exec(await readFile('supabase/migrations/20260916000100_partnership_channel_policy.sql','utf8'));
 const migration=await readFile('supabase/migrations/20260916001500_partnership_recipient_suppression_scope.sql','utf8');
 const company='00000000-0000-0000-0000-000000000001',recipient='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
 await db.query('insert into partner_companies values($1)',[company]);
 await db.query("insert into market_contacts(id,partner_company_id,phone,email,do_not_contact,stage,last_inbound_at) values($1,$3,'+15195550101','person@example.test',false,'qualified',now()),($2,$3,'+15195550102','other@example.test',true,'dnc',now())",[recipient,other,company]);
 let n=0;async function reserve(id=recipient,channel='phone') {return(await db.query("select reserve_partnership_action($1,$2,'reply',$3,jsonb_build_object('marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true,'observedAt',now())) as result",[id,channel,'test-action-'+(++n)])).rows[0].result}
 assert.deepEqual((await reserve()).reasons,['account_suppressed']);
 await db.exec(migration);await db.exec(migration);
 await t.test('An unrelated opted-out colleague does not block an inbound reply or call',async()=>{assert.equal((await reserve()).allowed,true);assert.equal((await reserve(recipient,'sms')).allowed,true)});
 await t.test('The opted-out person stays blocked',async()=>{assert.deepEqual((await reserve(other)).reasons,['recipient_suppressed'])});
 await t.test('A duplicate identity cannot bypass the opt-out with another formatted phone',async()=>{await db.query("update market_contacts set phone='519-555-0101' where id=$1",[other]);assert.equal((await reserve()).allowed,false);await db.query("update market_contacts set phone='+15195550102' where id=$1",[other])});
 await t.test('Shared email identity also preserves suppression',async()=>{await db.query("update market_contacts set email=' PERSON@example.test ' where id=$1",[other]);assert.equal((await reserve()).allowed,false);await db.query("update market_contacts set email='other@example.test' where id=$1",[other])});
 await t.test('Explicit company suppression and requested waits still block',async()=>{await db.query("insert into partnership_account_policy(account_id,suppressed,evidence_ref) values($1,true,'test')",[company]);assert.deepEqual((await reserve()).reasons,['account_policy_suppressed']);await db.query("update partnership_account_policy set suppressed=false,not_before=now()+interval '1 day' where account_id=$1",[company]);assert.deepEqual((await reserve()).reasons,['requested_wait'])});
 }finally{await db.close()}
});
