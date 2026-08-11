-- One operating system, organization-scoped views. These tables are shared by
-- internal CRM and future partner/crew portal experiences.
alter table public.subcontractors
  add column if not exists partner_code text,
  add column if not exists lifecycle_status text not null default 'applicant',
  add column if not exists tier text not null default 'trial',
  add column if not exists home_market text,
  add column if not exists max_travel_km numeric,
  add column if not exists notification_preferences jsonb not null default '{"sms":true,"email":true,"push":false}'::jsonb;

create unique index if not exists subcontractors_partner_code_unique on public.subcontractors(partner_code) where partner_code is not null;

create table if not exists public.partner_members (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  auth_user_id text,
  name text not null,
  phone text,
  email text,
  role text not null check (role in ('owner_admin', 'dispatcher_manager', 'crew_lead', 'driver', 'mover')),
  status text not null default 'active' check (status in ('invited', 'active', 'restricted', 'inactive')),
  approved_for_jobs boolean not null default false,
  is_driver boolean not null default false,
  experience_years numeric,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists partner_members_auth_unique on public.partner_members(auth_user_id) where auth_user_id is not null;
create index if not exists partner_members_org_idx on public.partner_members(subcontractor_id, status);

create table if not exists public.partner_vehicles (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  unit_code text not null,
  vehicle_type text not null,
  size_label text,
  ownership text not null default 'partner_owned' check (ownership in ('partner_owned', 'rented', 'leased')),
  status text not null default 'active' check (status in ('active', 'maintenance', 'unavailable', 'inactive')),
  insurance_verified boolean not null default false,
  insurance_expires_at date,
  brand_compliant boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subcontractor_id, unit_code)
);

create table if not exists public.partner_availability (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  member_id uuid references public.partner_members(id) on delete cascade,
  vehicle_id uuid references public.partner_vehicles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  availability text not null check (availability in ('available', 'limited', 'unavailable')),
  capacity jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists partner_availability_window_idx on public.partner_availability(subcontractor_id, starts_at, ends_at);

create table if not exists public.partner_documents (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  jurisdiction text,
  document_type text not null,
  status text not null default 'submitted' check (status in ('requested', 'submitted', 'under_review', 'verified', 'rejected', 'expired')),
  storage_path text,
  provider text,
  coverage_amount numeric,
  effective_at date,
  expires_at date,
  structured_data jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_documents_expiry_idx on public.partner_documents(status, expires_at);

create table if not exists public.partner_job_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  offer_id uuid references public.subcontractor_offers(id) on delete set null,
  subcontractor_id uuid not null references public.subcontractors(id),
  member_ids uuid[] not null default '{}'::uuid[],
  vehicle_ids uuid[] not null default '{}'::uuid[],
  role text not null default 'primary' check (role in ('primary', 'backup')),
  status text not null default 'assigned' check (status in ('assigned', 'confirmed', 'preparing', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show')),
  expected_start timestamptz,
  version integer not null default 1,
  acknowledged_version integer not null default 1,
  cancellation_reason text,
  cancellation_notice_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_job_assignments_live_idx on public.partner_job_assignments(status, expected_start);
create unique index if not exists partner_job_assignments_primary_unique on public.partner_job_assignments(lead_id, subcontractor_id) where role = 'primary';

create table if not exists public.partner_job_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.partner_job_assignments(id) on delete cascade,
  version integer not null,
  changes jsonb not null,
  changed_by text,
  changed_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_member_id uuid references public.partner_members(id),
  unique (assignment_id, version)
);

create table if not exists public.partner_rate_versions (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  terms jsonb not null,
  approved_by text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.partner_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid not null references public.subcontractors(id),
  lead_id text,
  offer_id uuid references public.subcontractor_offers(id) on delete set null,
  entry_type text not null check (entry_type in ('job_earning', 'approved_extra', 'adjustment', 'hold', 'hold_release', 'payout', 'payout_reversal')),
  amount numeric(12,2) not null,
  currency text not null default 'CAD',
  state text not null default 'estimated' check (state in ('estimated', 'pending_completion', 'under_review', 'approved', 'scheduled', 'processing', 'paid', 'failed', 'held')),
  description text not null,
  effective_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  external_transfer_id text,
  reverses_entry_id uuid references public.partner_ledger_entries(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists partner_ledger_partner_idx on public.partner_ledger_entries(subcontractor_id, effective_at);
create index if not exists partner_ledger_state_idx on public.partner_ledger_entries(state, effective_at);

create table if not exists public.partner_audit_events (
  id uuid primary key default gen_random_uuid(),
  subcontractor_id uuid references public.subcontractors(id),
  lead_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_user_id text,
  actor_name text,
  previous_value jsonb,
  next_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists partner_audit_entity_idx on public.partner_audit_events(entity_type, entity_id, created_at);

alter table public.partner_members enable row level security;
alter table public.partner_vehicles enable row level security;
alter table public.partner_availability enable row level security;
alter table public.partner_documents enable row level security;
alter table public.partner_job_assignments enable row level security;
alter table public.partner_job_versions enable row level security;
alter table public.partner_rate_versions enable row level security;
alter table public.partner_ledger_entries enable row level security;
alter table public.partner_audit_events enable row level security;
