-- Disposable PostgreSQL only. Never run this fixture against an existing database.
create role anon;
create role authenticated;
create role service_role;
create table partner_companies(id uuid primary key);
insert into partner_companies values('00000000-0000-0000-0000-000000000001');
create table market_contacts(id uuid primary key default gen_random_uuid(),name text,company text,phone text,city text,category text,industry text,stage text,pipeline_phase text,sequence_step int,sequence_paused boolean,do_not_contact boolean,partner_company_id uuid default '00000000-0000-0000-0000-000000000001',priority text,sequence_paused_reason text,email_unsubscribed_at timestamptz,last_inbound_at timestamptz);
create table market_campaigns(id uuid primary key default gen_random_uuid(),name text,tracking_code text,tier int,letters_sent int,sent_date date,cost_cents int,notes text);
create table sequence_jobs(id uuid primary key default gen_random_uuid(),contact_id uuid,batch_id uuid,channel text,scheduled_at timestamptz,status text,template_key text,execution_key text unique,sms_payload jsonb,provider_sid text,sent_at timestamptz,error text);
create table market_touches(id uuid primary key default gen_random_uuid(),contact_id uuid,channel text,direction text,created_at timestamptz,created_by text,notes text,metadata jsonb);
create table crm_leads(id text primary key,data jsonb,deleted boolean,updated_at timestamptz);
create table crm_sms_provider_events(message_key text,status text);
create table google_mail_connections(email text primary key,status text,campaign_enabled boolean);
