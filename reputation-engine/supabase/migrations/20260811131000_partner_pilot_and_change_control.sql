create table if not exists public.partner_onboarding_invites (
  id uuid primary key default gen_random_uuid(), subcontractor_id uuid references public.subcontractors(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique, phone text, email text, stage text not null default 'invited'
    check(stage in ('invited','screening','application','verification','agreement','payout_setup','brand_training','trial','active','declined')),
  application jsonb not null default '{}', checklist jsonb not null default '{}', agreement_version text,
  agreement_accepted_at timestamptz, agreement_signatory text, stripe_account_id text, stripe_status text,
  brand_acknowledged_at timestamptz, expires_at timestamptz, created_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists partner_onboarding_stage_idx on public.partner_onboarding_invites(stage, created_at);

create table if not exists public.partner_job_events (
  id uuid primary key default gen_random_uuid(), lead_id text not null,
  assignment_id uuid references public.partner_job_assignments(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  event_type text not null check(event_type in ('preparing','en_route','arrived','walkthrough_complete','work_started','loading_complete','destination_arrival','unloading_complete','final_walkthrough','completed','paused','resumed','trip_started','trip_completed','day_ended','day_started')),
  trip_number integer not null default 1, service_day integer not null default 1,
  actor_name text, note text, facts jsonb not null default '{}', occurred_at timestamptz not null default now()
);
create index if not exists partner_job_events_timeline_idx on public.partner_job_events(lead_id, occurred_at);

create table if not exists public.partner_change_orders (
  id uuid primary key default gen_random_uuid(), change_code text unique, customer_token uuid not null default gen_random_uuid() unique,
  lead_id text not null, offer_id uuid references public.subcontractor_offers(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  report_id uuid references public.partner_job_reports(id) on delete set null,
  change_type text not null check(change_type in ('inventory','extra_labor','extra_truck','extra_trip','waiting_time','access','weather','schedule','multi_day','other')),
  description text not null, evidence jsonb not null default '[]', billing_model text not null default 'fixed',
  customer_delta numeric(12,2) not null default 0, partner_delta numeric(12,2) not null default 0,
  estimated_extra_hours numeric, status text not null default 'operations_review'
    check(status in ('operations_review','customer_authorization','approved','declined','cancelled','completed')),
  operations_approved_at timestamptz, operations_approved_by text, customer_sent_at timestamptz,
  customer_decided_at timestamptz, customer_decision_ip text, customer_name text, customer_note text,
  expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists partner_change_orders_queue_idx on public.partner_change_orders(status, created_at);
create index if not exists partner_change_orders_job_idx on public.partner_change_orders(lead_id, created_at);

create table if not exists public.partner_simulation_runs (
  id uuid primary key default gen_random_uuid(), scenario text not null, status text not null check(status in ('passed','failed')),
  seed jsonb not null default '{}', events jsonb not null default '[]', assertions jsonb not null default '[]',
  run_by text, created_at timestamptz not null default now()
);

alter table public.partner_onboarding_invites enable row level security;
alter table public.partner_job_events enable row level security;
alter table public.partner_change_orders enable row level security;
alter table public.partner_simulation_runs enable row level security;
