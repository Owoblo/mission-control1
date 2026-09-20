-- Baseline reconstruction for the market outreach core tables.
--
-- These tables existed in production but were never created by any repo
-- migration; later migrations only ALTER them (first: 20260321050500).
-- Without this file, a fresh database fails on those ALTERs.
--
-- Reconstructed from the live production schema on 2026-09-20 (read-only).
-- Later migrations use ADD COLUMN IF NOT EXISTS, so on a fresh database they
-- become no-ops against this baseline. Constraints that later migrations
-- manage explicitly (stage CHECK on market_contacts) are intentionally left
-- to those migrations. Foreign keys to tables outside this baseline
-- (market_campaigns, partner_companies) are added by their original
-- migrations, not here.
--
-- NOT APPLIED to production. Review before running anywhere.

create table if not exists public.market_signals (
  id uuid primary key default gen_random_uuid(),
  signal_type text,
  company text,
  city text,
  description text,
  contact_name text,
  time_sensitivity text,
  action_required text,
  status text default 'new',
  actioned_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  claimed_by text,
  claimed_at timestamptz,
  converted_contact_id uuid,
  converted_at timestamptz
);

create table if not exists public.market_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  title text,
  email text,
  phone text,
  website text,
  address text,
  city text,
  province text,
  postal_code text,
  industry text,
  tier text,
  tracking_code text,
  stage text not null default 'cold',
  notes text,
  source_csv text,
  last_touch_at timestamptz,
  next_follow_up date,
  created_at timestamptz default now(),
  owner_name text,
  owner_email text,
  priority text not null default 'normal',
  account_status text not null default 'active',
  mailed_at timestamptz,
  mailed_by text,
  meeting_booked_at timestamptz,
  partnership_outcome text,
  partnership_outcome_at timestamptz,
  partnership_started_at timestamptz,
  last_inbound_at timestamptz,
  referred_lead_count integer not null default 0,
  batch_id uuid,
  sequence_step integer default 0,
  sequence_paused boolean default false,
  sequence_paused_reason text,
  pipeline_phase text default 'outreach',
  decision text,
  email_scheduled_at timestamptz,
  sms_scheduled_at timestamptz,
  linkedin_scheduled_at timestamptz,
  outreach_tier integer,
  instantly_lead_id text,
  instantly_campaign_id text,
  instantly_status text,
  affiliate_partner_id text,
  category text,
  partner_company_id uuid,
  assigned_manager_user_id text,
  preferred_channel text,
  relationship_score integer not null default 0,
  relationship_temperature text not null default 'cold',
  tags text[] not null default '{}',
  do_not_contact boolean not null default false,
  commission_rule_required boolean not null default true,
  listing_discovery_key text,
  email_status text default 'none',
  email_source text,
  email_verified_at timestamptz,
  email_verification_status text,
  email_verification_reason text,
  email_verification_provider text,
  email_verification_checked_at timestamptz,
  email_last_sent_at timestamptz,
  email_last_opened_at timestamptz,
  email_last_clicked_at timestamptz,
  email_last_replied_at timestamptz,
  email_last_bounced_at timestamptz,
  email_unsubscribed_at timestamptz,
  email_unsubscribe_token uuid default gen_random_uuid(),
  email_campaign_id text,
  email_campaign_name text,
  email_sequence_step integer,
  email_message_version text,
  email_provider text,
  email_provider_lead_id text,
  email_provider_message_id text,
  cross_channel_suppressed_at timestamptz,
  cross_channel_suppression_reason text,
  constraint market_contacts_email_unsubscribe_token_unique unique (email_unsubscribe_token)
);

create unique index if not exists market_contacts_listing_discovery_key
  on public.market_contacts (listing_discovery_key)
  where listing_discovery_key is not null;
create index if not exists idx_market_contacts_batch_id on public.market_contacts (batch_id);
create index if not exists idx_market_contacts_industry on public.market_contacts (industry);
create index if not exists idx_market_contacts_stage on public.market_contacts (stage);
create index if not exists idx_market_contacts_tier on public.market_contacts (tier);
create index if not exists market_contacts_assigned_manager_idx on public.market_contacts (assigned_manager_user_id, owner_email);
create index if not exists market_contacts_category_idx on public.market_contacts (category);
create index if not exists market_contacts_email_provider_message_idx on public.market_contacts (email_provider_message_id);
create index if not exists market_contacts_email_status_idx on public.market_contacts (email_status);
create index if not exists market_contacts_email_verification_idx on public.market_contacts (email_verification_status, email_verification_checked_at);
create index if not exists market_contacts_outreach_tier_idx on public.market_contacts (outreach_tier);
create index if not exists market_contacts_partner_company_id_idx on public.market_contacts (partner_company_id);
create index if not exists market_contacts_relationship_temperature_idx on public.market_contacts (relationship_temperature);
create index if not exists market_contacts_tags_gin_idx on public.market_contacts using gin (tags);

create table if not exists public.market_queue (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.market_contacts (id) on delete cascade,
  step_number integer not null default 1,
  channel text not null,
  due_date date not null,
  label text,
  message_draft text,
  status text not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz default now(),
  assigned_to text,
  completed_by text,
  priority text not null default 'normal'
);

create index if not exists idx_market_queue_contact on public.market_queue (contact_id);
create index if not exists idx_market_queue_due on public.market_queue (due_date, status);

create table if not exists public.market_touches (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.market_contacts (id) on delete cascade,
  channel text not null,
  direction text not null default 'outbound',
  notes text,
  created_by text,
  created_at timestamptz default now(),
  outcome_code text,
  next_step text,
  next_follow_up_on date,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_market_touches_contact on public.market_touches (contact_id);
