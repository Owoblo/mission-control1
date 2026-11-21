import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function preparedSmsDatabase(){
 const {PGlite}=await import(process.env.SSM_PGLITE_MODULE ? pathToFileURL(process.env.SSM_PGLITE_MODULE).href : '@electric-sql/pglite');

 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table partner_companies(id uuid primary key default gen_random_uuid(),company_name text,normalized_key text unique,industry text,address text,website text,city text,account_owner_user_id text,account_owner_name text,account_owner_email text,updated_at timestamptz);
 create table market_contacts(id uuid primary key default gen_random_uuid(),partner_company_id uuid references partner_companies(id),name text,company text,phone text,email text,city text,category text,industry text,address text,website text,assigned_manager_user_id text,owner_name text,owner_email text,stage text,pipeline_phase text,sequence_step integer,sequence_paused boolean,do_not_contact boolean,decision text,last_inbound_at timestamptz,cross_channel_suppressed_at timestamptz);
 create table market_campaigns(id uuid primary key default gen_random_uuid(),name text,tracking_code text,tier integer,letters_sent integer,sent_date date,cost_cents integer,notes text);
 create table sequence_jobs(id uuid primary key default gen_random_uuid(),contact_id uuid references market_contacts(id),batch_id uuid references market_campaigns(id),channel text,scheduled_at timestamptz,status text,template_key text);
 create table market_touches(id uuid primary key default gen_random_uuid(),contact_id uuid,direction text,created_at timestamptz,metadata jsonb,outcome_code text);
 create table crm_tasks(id text primary key default gen_random_uuid()::text,status text,related_type text,related_id text);
 create table partner_referrals(id uuid primary key default gen_random_uuid(),company_id uuid,job_id text,job_status text);`);
 const original=await readFile('supabase/migrations/20260704090000_partner_relationship_os.sql','utf8');
 await db.exec(original.slice(original.indexOf('create or replace function public.partner_company_normalized_key('),original.indexOf('create or replace function public.touch_partner_company_updated_at')));
 await db.exec(await readFile('supabase/migrations/20260916000400_preserve_explicit_partner_link.sql','utf8'));
 await db.exec(`create trigger market_contacts_link_partner_company before insert on market_contacts for each row execute function link_market_contact_partner_company();`);
 for(const file of ['20260916000100_partnership_channel_policy.sql','20260916000300_reviewed_partnership_handoffs.sql','20260916001500_partnership_recipient_suppression_scope.sql','20260921000100_prepared_sms_queue.sql','20260921000200_prepared_sms_identity_indexes.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 return db;
}
