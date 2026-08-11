alter table public.app_users
  add column if not exists partner_id uuid references public.subcontractors(id) on delete set null,
  add column if not exists partner_member_id uuid references public.partner_members(id) on delete set null;
create index if not exists app_users_partner_idx on public.app_users(partner_id) where partner_id is not null;
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check(role in ('owner','manager','sales_rep','operations_lead','crew','partnership_manager','partner_admin','partner_dispatcher','partner_crew'));

create table if not exists public.partner_compliance_rules (
  id uuid primary key default gen_random_uuid(), jurisdiction text not null, document_type text not null,
  label text not null, required boolean not null default true, conditional_note text,
  warning_days integer[] not null default '{60,30,14,7}', active boolean not null default true,
  created_at timestamptz not null default now(), unique(jurisdiction, document_type)
);

create table if not exists public.partner_claims (
  id uuid primary key default gen_random_uuid(), claim_code text unique,
  lead_id text not null, subcontractor_id uuid not null references public.subcontractors(id),
  report_id uuid references public.partner_job_reports(id) on delete set null,
  status text not null default 'reported' check(status in ('reported','acknowledged','evidence_collection','investigating','partner_response','decision','resolution','closed')),
  severity text not null default 'level_2' check(severity in ('level_1','level_2','level_3','level_4')),
  title text not null, description text, customer_visible_summary text, resolution text,
  assigned_to text, opened_at timestamptz not null default now(), closed_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists partner_claims_queue_idx on public.partner_claims(status, severity, opened_at);

create table if not exists public.partner_claim_events (
  id uuid primary key default gen_random_uuid(), claim_id uuid not null references public.partner_claims(id) on delete cascade,
  actor_type text not null check(actor_type in ('internal','partner','system')), actor_name text,
  event_type text not null, body text not null, media jsonb not null default '[]', internal_only boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists partner_claim_events_timeline_idx on public.partner_claim_events(claim_id, created_at);

create table if not exists public.partner_performance_snapshots (
  id uuid primary key default gen_random_uuid(), subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  period_start date not null, period_end date not null, score numeric not null,
  metrics jsonb not null default '{}', tier text, calculated_at timestamptz not null default now(),
  unique(subcontractor_id, period_start, period_end)
);

create table if not exists public.partner_corrective_actions (
  id uuid primary key default gen_random_uuid(), subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  status text not null default 'open' check(status in ('open','monitoring','resolved','escalated')),
  issue text not null, required_action text not null, review_job_count integer, owner_name text,
  opened_at timestamptz not null default now(), due_at timestamptz, resolved_at timestamptz, updated_at timestamptz not null default now()
);

create table if not exists public.partner_payout_batches (
  id uuid primary key default gen_random_uuid(), batch_code text unique, status text not null default 'draft' check(status in ('draft','approved','processing','paid','failed','cancelled')),
  currency text not null default 'CAD', cutoff_at timestamptz not null, total_amount numeric(12,2) not null default 0,
  approved_by text, approved_at timestamptz, external_batch_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.partner_ledger_entries add column if not exists payout_batch_id uuid references public.partner_payout_batches(id) on delete set null;

create or replace function public.reject_partner_ledger_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Partner ledger entries cannot be deleted; create a reversal.'; end if;
  if new.subcontractor_id <> old.subcontractor_id or new.amount <> old.amount or new.currency <> old.currency or new.entry_type <> old.entry_type or new.lead_id is distinct from old.lead_id or new.offer_id is distinct from old.offer_id then
    raise exception 'Financial identity is immutable; create an adjustment or reversal.';
  end if;
  return new;
end $$;
drop trigger if exists partner_ledger_immutable_update on public.partner_ledger_entries;
create trigger partner_ledger_immutable_update before update or delete on public.partner_ledger_entries for each row execute function public.reject_partner_ledger_mutation();

alter table public.partner_compliance_rules enable row level security;
alter table public.partner_claims enable row level security;
alter table public.partner_claim_events enable row level security;
alter table public.partner_performance_snapshots enable row level security;
alter table public.partner_corrective_actions enable row level security;
alter table public.partner_payout_batches enable row level security;

insert into public.partner_compliance_rules(jurisdiction,document_type,label,required,conditional_note) values
('CA-ON','business_registration','Business registration',true,null),
('CA-ON','liability_insurance','Commercial liability insurance',true,null),
('CA-ON','additional_insured','Saturn Star additional insured certificate',true,null),
('CA-ON','subcontractor_agreement','Subcontractor agreement',true,null),
('CA-ON','wsib','WSIB clearance',false,'Required where applicable'),
('CA-ON','payout_verification','Payout identity verification',true,null)
on conflict(jurisdiction,document_type) do nothing;
