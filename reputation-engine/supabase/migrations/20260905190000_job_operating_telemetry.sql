alter table if exists public.job_outcomes
  add column if not exists estimated_volume_cf numeric,
  add column if not exists estimated_weight_lbs numeric,
  add column if not exists estimated_crew integer,
  add column if not exists estimated_costs_cents integer,
  add column if not exists estimated_profit_cents integer,
  add column if not exists estimated_margin_pct numeric,
  add column if not exists actual_profit_cents integer,
  add column if not exists hours_variance numeric,
  add column if not exists cost_variance_cents integer,
  add column if not exists primary_bottleneck text,
  add column if not exists variance_reasons jsonb not null default '[]'::jsonb,
  add column if not exists actuals_complete boolean not null default false;

do $$
begin
  if to_regclass('public.job_outcomes') is not null then
    create index if not exists job_outcomes_bottleneck_idx
      on public.job_outcomes(primary_bottleneck, move_date desc);
    comment on column public.job_outcomes.primary_bottleneck is
      'Primary operating constraint inferred from execution issues and estimated-vs-actual variance.';
  end if;
end $$;
