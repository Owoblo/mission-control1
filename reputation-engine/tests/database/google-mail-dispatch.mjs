import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
const id='00000000-0000-4000-a000-000000000001',jid='00000000-0000-4000-a000-000000000002',sender='john@saturnstarpartners.com'
async function fixture(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
create table market_contacts(id uuid primary key,email text,do_not_contact boolean default false,cross_channel_suppressed_at timestamptz,email_unsubscribed_at timestamptz,email_status text,last_inbound_at timestamptz,sequence_paused boolean default false,sequence_paused_reason text);
create table market_touches(contact_id uuid,channel text,direction text,notes text,created_by text,created_at timestamptz,metadata jsonb);
create table sequence_jobs(id uuid,contact_id uuid,status text,error text);
create table prepared_email_reviews(id text primary key,record jsonb);
create table partnership_action_reservations(action_key text primary key,contact_id uuid,channel text,evidence jsonb);
create function reserve_partnership_action(c uuid,ch text,k text,ak text,e jsonb) returns jsonb language plpgsql as $$ begin
 if not coalesce((e->>'observedAt')::timestamptz between now()-interval '2 minutes' and now(),false) then raise exception 'policy evidence stale'; end if;
 insert into partnership_action_reservations values(ak,c,ch,e);return '{"allowed":true}'::jsonb;end $$;`)
await db.exec(await fs.readFile('supabase/migrations/20261109000100_google_mail_oauth.sql','utf8'))
await db.exec(await fs.readFile('supabase/migrations/20261109003000_google_mail_dispatch.sql','utf8'))
await db.query("insert into google_mail_connections(email,refresh_token_encrypted,scopes,connected_by) values($1,'fixture','{}','owner')",[sender])
await db.query("insert into market_contacts(id,email) values($1,'client@example.test')",[id])
await db.query("insert into prepared_email_reviews values('review',$1)",[{status:'approved',contentHash:'abc',contactId:id,expiresAt:new Date(Date.now()+3600000).toISOString()}])
await db.query('insert into google_mail_jobs(id,action_key,contact_id,payload) values($1,$2,$3,$4)',[jid,'action',id,{replyTo:sender,recipient:'client@example.test',reviewId:'review',contentHash:'abc',sender:'John <'+sender+'>',subject:'Hello',text:'Body'}])
await db.query('insert into google_mail_health(email,ready,checked_at,sync_checked_at) values($1,true,now(),now())',[sender])
return db}
const claim=(db,overrides={})=>db.query('select claim_google_mail_job($1,$2) as r',[jid,{sender:'John <'+sender+'>',recipient:'client@example.test',observedAt:new Date().toISOString(),contentHash:createHash('sha256').update('Hello\nBody').digest('hex'),...overrides}]).then(r=>r.rows[0].r)
async function ready(db){await db.exec('alter table google_mail_connections drop constraint google_mail_connections_campaign_enabled_check;update google_mail_connections set campaign_enabled=true;update google_mail_fleet_settings set enabled=true')}
test('migration leaves campaigns impossible to activate without a separate rollout migration',async()=>{const db=await fixture();try{
 await assert.rejects(claim(db),/disabled/);await assert.rejects(db.exec('update google_mail_connections set campaign_enabled=true'),/check constraint/)
}finally{await db.close()}})
test('claim is single-use and accepted receipt retains sender and thread',async()=>{const db=await fixture();try{await ready(db)
 assert.equal((await claim(db)).claimed,true);assert.equal((await claim(db)).claimed,false)
 await db.query('select finish_google_mail_job($1,$2,$3,$4,$5)',[jid,'accepted','gmail-id','thread','<rfc@example.test>'])
 assert.equal((await claim(db)).state,'accepted')
 const a=(await db.query('select * from google_mail_assignments')).rows[0];assert.equal(a.email,sender);assert.equal(a.thread_id,'thread')
}finally{await db.close()}})
test('stale sync, health, suppression and missing policy timestamps fail closed',async()=>{const db=await fixture();try{await ready(db)
 await db.exec("update google_mail_health set sync_checked_at=now()-interval '6 minutes'");await assert.rejects(claim(db),/stale/)
 await db.exec("update google_mail_health set sync_checked_at=now(),ready=false");await assert.rejects(claim(db),/stale/)
 await db.exec('update google_mail_health set ready=true;update market_contacts set do_not_contact=true');await assert.rejects(claim(db),/suppressed/)
 await db.exec('update market_contacts set do_not_contact=false');await assert.rejects(claim(db,{observedAt:null}),/policy/)
 assert.equal((await db.query('select count(*)::int n from google_mail_assignments')).rows[0].n,0)
}finally{await db.close()}})
test('inbound response pauses conversation and cancels pending work idempotently',async()=>{const db=await fixture();try{await ready(db);await claim(db)
 await db.query('select finish_google_mail_job($1,$2,$3,$4,$5)',[jid,'accepted','gmail-id','thread','<rfc@example.test>'])
 await db.query('insert into google_mail_jobs(action_key,contact_id,payload) values($1,$2,$3)',['followup',id,{}])
 const args=[sender,'inbound-id',id,'thread',new Date().toISOString(),'response']
 await db.query('select record_google_mail_inbound($1,$2,$3,$4,$5,$6)',args);await db.query('select record_google_mail_inbound($1,$2,$3,$4,$5,$6)',args)
 assert.equal((await db.query('select count(*)::int n from google_mail_inbound')).rows[0].n,1)
 assert.equal((await db.query("select state from google_mail_jobs where action_key='followup'")).rows[0].state,'cancelled')
 assert.equal((await db.query('select sequence_paused from market_contacts')).rows[0].sequence_paused,true)
}finally{await db.close()}})
test('capacity and pacing holds consume no relationship reservation',async()=>{const db=await fixture();try{await ready(db)
 await db.query("insert into google_mail_jobs(action_key,contact_id,payload,state,claimed_at) values('previous',$1,$2,'unknown',now()-interval '1 hour')",[id,{replyTo:sender}])
 // A different recipient avoids the unresolved-contact gate while consuming the same inbox budget.
 await db.query("update google_mail_jobs set state='rejected' where action_key='previous'")
 await db.exec('update google_mail_fleet_settings set inbox_cap=1')
 await assert.rejects(claim(db),/inbox capacity/)
 assert.equal((await db.query('select count(*)::int n from partnership_action_reservations')).rows[0].n,0)
 await db.exec('update google_mail_fleet_settings set inbox_cap=10,domain_cap=1')
 await assert.rejects(claim(db),/domain capacity/)
 await db.exec("update google_mail_fleet_settings set domain_cap=20;update google_mail_jobs set claimed_at=now() where action_key='previous'")
 await assert.rejects(claim(db),/pacing/)
 assert.equal((await db.query('select count(*)::int n from partnership_action_reservations')).rows[0].n,0)
}finally{await db.close()}})
test('reviewed body and mailbox assignment are immutable',async()=>{const db=await fixture();try{await ready(db)
 await assert.rejects(db.query("update google_mail_jobs set payload='{}' where id=$1",[jid]),/immutable/)
 await claim(db)
 await assert.rejects(db.query("update google_mail_assignments set email='johnny@saturnstarpartners.com' where contact_id=$1",[id]),/immutable/)
}finally{await db.close()}})
