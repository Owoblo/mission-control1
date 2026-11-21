create table if not exists public.crm_callback_action_reservations (
 action_key text primary key,
 provider_account text not null,
 provider_call_id text not null,
 action_type text not null check(action_type='missed_call_reply'),
 state text not null default 'reserved' check(state in ('reserved','handed_off','unknown')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.crm_callback_action_reservations enable row level security;
revoke all on public.crm_callback_action_reservations from anon,authenticated;
grant select,insert,update on public.crm_callback_action_reservations to service_role;
