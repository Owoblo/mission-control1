create table if not exists public.partnership_daily_briefs (
 id text primary key,
 market text not null,
 report_date date not null,
 recipient text not null,
 state text not null check (state in ('reserved','accepted')),
 subject text not null,
 body text not null,
 counts jsonb not null default '{}'::jsonb,
 provider_message_id text,
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 unique(market,report_date)
);
alter table public.partnership_daily_briefs enable row level security;
revoke all on public.partnership_daily_briefs from public,anon,authenticated;
grant select,insert,update on public.partnership_daily_briefs to service_role;
