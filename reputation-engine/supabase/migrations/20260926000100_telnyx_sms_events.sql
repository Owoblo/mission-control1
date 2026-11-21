create table if not exists public.crm_sms_provider_events (
  event_id text primary key,
  provider text not null check (provider in ('twilio', 'telnyx')),
  provider_message_id text not null,
  message_key text not null,
  event_type text not null,
  status text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_sms_provider_events_message_idx
  on public.crm_sms_provider_events (message_key, occurred_at desc);
alter table public.crm_sms_provider_events enable row level security;
revoke all on public.crm_sms_provider_events from public, anon, authenticated;
grant all on public.crm_sms_provider_events to service_role;
