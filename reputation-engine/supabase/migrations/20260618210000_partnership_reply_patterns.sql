create table if not exists public.partnership_reply_patterns (
  id uuid primary key default gen_random_uuid(),
  name text,
  intent_category text not null,
  sample_inbound text not null,
  approved_strategy text not null,
  approved_draft text not null,
  required_context jsonb not null default '{}'::jsonb,
  risk_blocks jsonb not null default '[]'::jsonb,
  auto_send_eligible boolean not null default false,
  min_confidence numeric not null default 0.9,
  approved_by text,
  approved_at timestamp with time zone default now(),
  usage_count integer not null default 0,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists partnership_reply_patterns_intent_idx
  on public.partnership_reply_patterns (intent_category);

create index if not exists partnership_reply_patterns_auto_send_idx
  on public.partnership_reply_patterns (auto_send_eligible)
  where auto_send_eligible = true;

alter table if exists public.market_touches
  add column if not exists ai_intent text,
  add column if not exists ai_confidence numeric,
  add column if not exists ai_extracted jsonb not null default '{}'::jsonb,
  add column if not exists ai_draft_sms text,
  add column if not exists ai_risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists matched_reply_pattern_id uuid references public.partnership_reply_patterns(id);

