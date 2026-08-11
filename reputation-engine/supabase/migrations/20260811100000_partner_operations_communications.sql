alter table public.subcontractor_offers
  add column if not exists sanitized_briefing text,
  add column if not exists awarded_crew_briefing text,
  add column if not exists readiness_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists auto_prepared boolean not null default false;

create table if not exists public.partner_job_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  offer_id uuid references public.subcontractor_offers(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  direction text not null check (direction in ('partner_to_operations', 'operations_to_partner', 'system')),
  channel text not null default 'portal' check (channel in ('portal', 'sms', 'email', 'system')),
  body text not null,
  media jsonb not null default '[]'::jsonb,
  sender_name text,
  urgent boolean not null default false,
  external_message_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists partner_job_messages_external_unique
  on public.partner_job_messages(external_message_id) where external_message_id is not null;
create index if not exists partner_job_messages_job_idx on public.partner_job_messages(lead_id, created_at);
create index if not exists partner_job_messages_partner_idx on public.partner_job_messages(subcontractor_id, created_at);

create table if not exists public.partner_job_reports (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  offer_id uuid references public.subcontractor_offers(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  report_type text not null check (report_type in (
    'additional_inventory', 'access_problem', 'parking_problem', 'customer_disagreement',
    'damage_discovered', 'damage_occurred', 'truck_issue', 'crew_issue', 'delay',
    'additional_labor', 'additional_truck', 'safety_concern', 'payment_issue', 'other'
  )),
  severity text not null default 'routine' check (severity in ('routine', 'urgent', 'critical')),
  status text not null default 'reported' check (status in ('reported', 'acknowledged', 'investigating', 'approved', 'declined', 'resolved', 'closed')),
  summary text not null,
  details text,
  requested_extra_hours numeric,
  requested_adjustment numeric(12,2),
  media jsonb not null default '[]'::jsonb,
  reported_by text,
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_job_reports_open_idx on public.partner_job_reports(status, severity, created_at);
create index if not exists partner_job_reports_job_idx on public.partner_job_reports(lead_id, created_at);

create table if not exists public.partner_job_checklists (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  offer_id uuid references public.subcontractor_offers(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  checklist_type text not null check (checklist_type in ('pre_job', 'arrival', 'completion')),
  items jsonb not null default '{}'::jsonb,
  notes text,
  completed_at timestamptz,
  completed_by text,
  updated_at timestamptz not null default now(),
  unique (lead_id, subcontractor_id, checklist_type)
);

alter table public.partner_job_messages enable row level security;
alter table public.partner_job_reports enable row level security;
alter table public.partner_job_checklists enable row level security;
