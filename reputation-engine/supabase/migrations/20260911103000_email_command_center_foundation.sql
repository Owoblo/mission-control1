-- Provider-neutral email command center foundation for partnership outreach.
-- Saturn CRM remains the source of truth while Resend, SES, Sendy, or Instantly act as delivery providers.

alter table if exists public.market_contacts
  add column if not exists email_status text default 'none',
  add column if not exists email_source text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists email_verification_status text,
  add column if not exists email_verification_reason text,
  add column if not exists email_verification_provider text,
  add column if not exists email_verification_checked_at timestamptz,
  add column if not exists email_last_sent_at timestamptz,
  add column if not exists email_last_opened_at timestamptz,
  add column if not exists email_last_clicked_at timestamptz,
  add column if not exists email_last_replied_at timestamptz,
  add column if not exists email_last_bounced_at timestamptz,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists email_unsubscribe_token uuid default gen_random_uuid(),
  add column if not exists email_campaign_id text,
  add column if not exists email_campaign_name text,
  add column if not exists email_sequence_step integer,
  add column if not exists email_message_version text,
  add column if not exists email_provider text,
  add column if not exists email_provider_lead_id text,
  add column if not exists email_provider_message_id text,
  add column if not exists cross_channel_suppressed_at timestamptz,
  add column if not exists cross_channel_suppression_reason text;

create table if not exists public.email_sender_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend', 'ses', 'sendy', 'instantly', 'zoho')),
  domain text not null,
  from_email text not null,
  from_name text not null default 'Saturn Star Movers',
  reply_to_email text,
  region text,
  status text not null default 'setup' check (status in ('setup', 'warming', 'active', 'paused', 'error', 'retired')),
  daily_cap integer not null default 25,
  ramp_day integer not null default 0,
  health_score numeric,
  warmup_provider text,
  warmup_started_at timestamptz,
  campaign_ready_at timestamptz,
  last_health_checked_at timestamptz,
  last_bounce_rate numeric,
  last_complaint_rate numeric,
  last_reply_rate numeric,
  pause_reason text,
  last_error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, from_email)
);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  city text,
  region text,
  provider text not null default 'resend' check (provider in ('resend', 'ses', 'sendy', 'instantly', 'zoho')),
  sender_account_id uuid references public.email_sender_accounts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'review', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  daily_cap integer not null default 100,
  message_version text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  step_number integer not null,
  delay_days integer not null default 0,
  subject_template text not null,
  html_template text,
  text_template text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  created_at timestamptz not null default now(),
  unique(campaign_id, step_number)
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid references public.market_contacts(id) on delete set null,
  email text not null,
  first_name text,
  company text,
  city text,
  category text,
  status text not null default 'queued' check (status in ('queued', 'scheduled', 'sent', 'opened', 'clicked', 'replied', 'bounced', 'complained', 'unsubscribed', 'suppressed', 'failed', 'completed')),
  current_step integer not null default 0,
  sender_account_id uuid references public.email_sender_accounts(id) on delete set null,
  provider_message_id text,
  last_event_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, email)
);

create table if not exists public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend', 'ses', 'sendy', 'instantly', 'zoho')),
  provider_event_id text,
  provider_message_id text,
  campaign_id uuid references public.email_campaigns(id) on delete set null,
  recipient_id uuid references public.email_campaign_recipients(id) on delete set null,
  contact_id uuid references public.market_contacts(id) on delete set null,
  event_type text not null,
  recipient_email text,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists email_sender_accounts_provider_status_idx on public.email_sender_accounts(provider, status);
create index if not exists email_sender_accounts_domain_status_idx on public.email_sender_accounts(domain, status);
create index if not exists email_campaigns_status_provider_idx on public.email_campaigns(status, provider);
create index if not exists email_campaign_recipients_status_idx on public.email_campaign_recipients(campaign_id, status);
create index if not exists email_campaign_recipients_email_idx on public.email_campaign_recipients(lower(email));
create index if not exists email_provider_events_message_idx on public.email_provider_events(provider, provider_message_id);
create index if not exists email_provider_events_contact_idx on public.email_provider_events(contact_id, occurred_at desc);
create index if not exists market_contacts_email_status_idx on public.market_contacts(email_status);
create index if not exists market_contacts_email_verification_idx on public.market_contacts(email_verification_status, email_verification_checked_at);
create index if not exists market_contacts_email_provider_message_idx on public.market_contacts(email_provider_message_id);
create unique index if not exists market_contacts_email_unsubscribe_token_idx on public.market_contacts(email_unsubscribe_token);

create table if not exists public.outreach_playbook_learnings (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'email', 'call', 'direct_mail', 'digital_card')),
  category text,
  city text,
  audience text,
  trigger_type text,
  message_version text,
  variant text,
  sample_size integer not null default 0,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  reply_count integer not null default 0,
  positive_reply_count integer not null default 0,
  negative_reply_count integer not null default 0,
  bounce_count integer not null default 0,
  complaint_count integer not null default 0,
  opt_out_count integer not null default 0,
  opportunity_count integer not null default 0,
  booked_count integer not null default 0,
  reply_rate numeric,
  positive_reply_rate numeric,
  bounce_rate numeric,
  complaint_rate numeric,
  confidence text not null default 'learning' check (confidence in ('learning', 'promising', 'winner', 'loser', 'retired')),
  lesson text,
  recommended_change text,
  promoted_at timestamptz,
  retired_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_reply_patterns (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'email', 'call')),
  category text,
  city text,
  pattern_key text not null,
  intent text not null,
  example_inbound text,
  safe_reply_template text,
  required_facts text[] not null default '{}',
  automation_level text not null default 'manual_review' check (automation_level in ('manual_review', 'suggest_only', 'auto_safe')),
  success_count integer not null default 0,
  failure_count integer not null default 0,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel, pattern_key)
);


create index if not exists outreach_playbook_learnings_lookup_idx on public.outreach_playbook_learnings(channel, category, city, confidence);
create index if not exists outreach_reply_patterns_lookup_idx on public.outreach_reply_patterns(channel, intent, automation_level);
