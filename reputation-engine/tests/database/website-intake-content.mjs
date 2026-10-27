import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const migration=await readFile('supabase/migrations/20261027000300_website_intake_content_guard.sql','utf8')
const scam='Read the news and earn $50,000,000 per month https://telegra.ph/Read-the-latest-news-and-earn-50000000-in-a-month-Message-ID-fixture'
async function fixture(beforeMigration){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
create table crm_leads(id text primary key,data jsonb not null,deleted boolean default false,updated_at timestamptz default now());
create table inbound_leads(id uuid primary key default gen_random_uuid(),source text,name text,phone text,message text,raw_data jsonb default '{}',claimed boolean default false,claimed_at timestamptz);
create table crm_automation_jobs(id text primary key,lead_id text,payload jsonb,status text,locked_at timestamptz,last_error text,updated_at timestamptz default now());
create table analytics_events(id text primary key,event_type text,ts timestamptz,created_at timestamptz,properties jsonb);
create function crm_sales_alert_recipients(text) returns jsonb language sql as $$select '["business@example.test","staff@example.test"]'::jsonb$$;
create function crm_website_intake_alert() returns trigger language plpgsql as $$begin return new;end$$;
create trigger crm_website_intake_alert after insert on inbound_leads for each row execute function crm_website_intake_alert();`);await db.exec(await readFile('supabase/migrations/20261023000200_internal_alert_outbox.sql','utf8'));if(beforeMigration)await beforeMigration(db);await db.exec(migration);return db}
test('known website spam is preserved and held before notifications, with durable review evidence',async()=>{const db=await fixture();try{
 const row=(await db.query('insert into inbound_leads(source,name,message,raw_data) values($1,$2,$3,$4) returning *',['website_form','Edwardfreex',scam,{message:scam,move_from:'Czech Republic'}])).rows[0]
 assert.equal(row.message,scam);assert.equal(row.raw_data.message,scam);assert.equal(row.raw_data.inboxDisposition,'junk');assert.equal(row.raw_data.websiteSpamReview.state,'held');assert.equal(row.claimed,true)
 assert.equal((await db.query('select count(*)::int as n from crm_alert_outbox')).rows[0].n,0)
 assert.equal((await db.query('select properties from analytics_events')).rows[0].properties.inboundId,row.id)
 assert.equal((await db.query("select has_function_privilege('anon','crm_hold_website_submission()','execute') as yes")).rows[0].yes,false)
}finally{await db.close()}})
test('ordinary and international enquiries retain their full request in CRM while emails contain only the trusted notification and link',async()=>{const db=await fixture();try{
 const message='Moving from Czech Republic to Windsor. See https://example.test/inventory and <img src=x onerror=alert(1)>; storage budget $500 per month.'
 const row=(await db.query('insert into inbound_leads(source,name,phone,message,raw_data) values($1,$2,$3,$4,$5) returning *',['website_form','Edwardfreex','+15195550199',message,{move_date:'1984-08-00'}])).rows[0]
 assert.equal(row.claimed,false);assert.equal(row.message,message);assert.equal(row.raw_data.inboxDisposition,undefined)
 const alerts=(await db.query('select payload from crm_alert_outbox')).rows;assert.equal(alerts.length,2)
 for(const {payload} of alerts){assert.equal(payload.subject,'New website enquiry');assert.match(payload.html,/https:\/\/go.quote2move.com\/sales\/inbox/);assert.doesNotMatch(payload.html,/Edward|Czech|example\.test|img|onerror|500|15195550199/)}
 await db.query('insert into inbound_leads(source,message,raw_data) values($1,$2,$3)',['website_form','Normal check',{healthCheck:true}]);assert.equal((await db.query('select count(*)::int as n from crm_alert_outbox')).rows[0].n,2)
}finally{await db.close()}})
test('migration holds only the observed historical campaign, cancels pending work, and preserves accepted mail evidence and original content',async()=>{const db=await fixture(async db=>{
 await db.query("insert into crm_leads(id,data) values('lead',$1)",[{automationStatus:'active',name:'Historical'}]);await db.query("insert into inbound_leads(id,source,message,raw_data) values('00000000-0000-4000-a000-000000000001','website_form',$1,$2)",[scam,{linkedLeadId:'lead',inquiry_id:'original-inquiry',message:scam}]);await db.query("insert into crm_automation_jobs(id,lead_id,payload,status) values('job','lead',$1,'pending')",[{source:'website_form',message:scam}]);await db.exec("insert into crm_alert_outbox(id,event_key,payload,state) values('accepted','website-intake:original-inquiry','{}','accepted'),('pending','website-intake:original-inquiry','{}','pending')")
});try{
 const intake=(await db.query('select * from inbound_leads')).rows[0];assert.equal(intake.message,scam);assert.equal(intake.raw_data.message,scam);assert.equal(intake.raw_data.inboxDisposition,'junk')
 assert.equal((await db.query('select status from crm_automation_jobs')).rows[0].status,'cancelled');assert.equal((await db.query('select data from crm_leads')).rows[0].data.automationStatus,'handoff')
 assert.deepEqual((await db.query('select id,state from crm_alert_outbox order by id')).rows,[{id:'accepted',state:'accepted'},{id:'pending',state:'failed'}]);assert.equal((await db.query('select count(*)::int as n from analytics_events')).rows[0].n,1)
}finally{await db.close()}})
test('new and replayed website response jobs cannot escape a hold; ordinary jobs and a customer quoting a link in SMS are unaffected',async()=>{const db=await fixture();try{
 await db.query("insert into crm_leads(id,data) values('lead',$1)",[{automationStatus:'active'}]);await db.query("insert into crm_automation_jobs(id,lead_id,payload,status) values('job','lead',$1,'pending')",[{source:'website_form',message:scam}]);assert.equal((await db.query("select status from crm_automation_jobs where id='job'")).rows[0].status,'cancelled');await db.exec("update crm_automation_jobs set status='running' where id='job'");assert.equal((await db.query("select status from crm_automation_jobs where id='job'")).rows[0].status,'cancelled')
 await db.query("insert into crm_automation_jobs(id,lead_id,payload,status) values('sms','lead',$1,'pending')",[{source:'twilio_sms',message:scam}]);assert.equal((await db.query("select status from crm_automation_jobs where id='sms'")).rows[0].status,'pending')
}finally{await db.close()}})
