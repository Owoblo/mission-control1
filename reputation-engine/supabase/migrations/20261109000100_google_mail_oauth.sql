-- Credentials never readable by browser roles. Application encryption key is stored separately.
create table public.google_mail_connections (
 email text primary key,
 refresh_token_encrypted text not null,
 scopes text[] not null,
 connected_by text not null,
 connected_at timestamptz not null default now(),
 status text not null default 'connected' check(status in ('connected','reconnect_required')),
 campaign_enabled boolean not null default false check(campaign_enabled = false)
);
create table public.google_mail_oauth_attempts (
 state_hash text primary key,
 owner_id text not null,
 binding_hash text not null,
 email text not null,
 verifier_encrypted text not null,
 expires_at timestamptz not null
);
alter table public.google_mail_connections enable row level security;
alter table public.google_mail_oauth_attempts enable row level security;
revoke all on public.google_mail_connections, public.google_mail_oauth_attempts from public, anon, authenticated;
grant all on public.google_mail_connections, public.google_mail_oauth_attempts to service_role;
