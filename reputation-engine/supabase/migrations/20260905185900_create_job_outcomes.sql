-- Baseline reconstruction for job_outcomes.
--
-- The table existed in production but was never created by any repo
-- migration; later migrations only ALTER it (first: 20260905190000).
-- Without this file, a fresh database fails on those ALTERs.
--
-- Reconstructed from the live production schema on 2026-09-20 (read-only).
-- The 20260905190000 migration uses ADD COLUMN IF NOT EXISTS, so on a fresh
-- database it becomes a no-op against this baseline.
--
-- NOT APPLIED to production. Review before running anywhere.

create table if not exists public.job_outcomes (
  id text primary key,
  lead_id text not null,
  quote_id text,
  rep_id text,
  move_date date,
  estimated_hours numeric,
  actual_hours numeric,
  estimated_crew integer,
  actual_crew integer,
  revenue_cents bigint,
  total_costs_cents bigint,
  net_profit_cents bigint,
  margin_pct numeric,
  damage_flag boolean default false,
  customer_rating integer,
  review_left boolean default false,
  referral_generated boolean default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  estimated_volume_cf numeric,
  estimated_weight_lbs numeric,
  estimated_costs_cents integer,
  estimated_profit_cents integer,
  estimated_margin_pct numeric,
  actual_profit_cents integer,
  hours_variance numeric,
  cost_variance_cents integer,
  primary_bottleneck text,
  variance_reasons jsonb not null default '[]'::jsonb,
  actuals_complete boolean not null default false
);

create index if not exists job_outcomes_bottleneck_idx
  on public.job_outcomes (primary_bottleneck, move_date desc);
