-- Durable policy, incident and learning records. These keep operating state in
-- Saturn OS so a new founder-console session can reconstruct the same truth.
create table if not exists public.saturn_policy_registry (
  policy_id text primary key,
  domain text not null,
  version text not null,
  rule text not null,
  scope text not null default 'global',
  effective_at timestamptz not null default now(),
  approved_by text,
  status text not null default 'active' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now()
);

create table if not exists public.saturn_ai_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  contact_id uuid,
  channel text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create table if not exists public.saturn_ai_decisions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid,
  input jsonb not null default '{}'::jsonb,
  prediction jsonb not null default '{}'::jsonb,
  human_correction jsonb,
  policy_version text,
  model_version text,
  created_at timestamptz not null default now()
);

alter table public.saturn_policy_registry enable row level security;
alter table public.saturn_ai_incidents enable row level security;
alter table public.saturn_ai_decisions enable row level security;
revoke all on public.saturn_policy_registry, public.saturn_ai_incidents, public.saturn_ai_decisions from public, anon, authenticated;
grant select, insert, update on public.saturn_policy_registry, public.saturn_ai_incidents, public.saturn_ai_decisions to service_role;

insert into public.saturn_policy_registry(policy_id, domain, version, rule, approved_by)
values
  ('PARTNERSHIP.SEND.001', 'partnership', 'partnership-policy-v1', 'Reject every outbound message containing unresolved template variables.', 'John'),
  ('PARTNERSHIP.IDENTITY.001', 'partnership', 'partnership-policy-v1', 'Use a verified person name when available; otherwise greet generically or by business name.', 'John'),
  ('PARTNERSHIP.FACTS.001', 'partnership', 'partnership-policy-v1', 'Facts such as city, sender line, pricing, appointments and promises come from Saturn state.', 'John')
on conflict (policy_id) do update set version = excluded.version, rule = excluded.rule, status = 'active';

