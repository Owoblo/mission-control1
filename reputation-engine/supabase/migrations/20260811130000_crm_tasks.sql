create table if not exists public.crm_tasks (
  id text primary key,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  category text not null default 'general',
  due_at timestamptz,
  owner_user_id text,
  owner_name text,
  branch text,
  related_type text check (related_type in ('lead', 'job', 'customer', 'review', 'partner', 'property', 'relationship')),
  related_id text,
  related_label text,
  source text not null default 'manual' check (source in ('manual', 'stage', 'condition')),
  source_key text unique,
  created_by_user_id text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by_user_id text,
  completed_by_name text,
  outcome_note text,
  next_task_id text references public.crm_tasks(id) on delete set null
);

create index if not exists crm_tasks_status_due_idx on public.crm_tasks(status, due_at);
create index if not exists crm_tasks_owner_status_idx on public.crm_tasks(owner_user_id, status);
create index if not exists crm_tasks_related_idx on public.crm_tasks(related_type, related_id);
create index if not exists crm_tasks_branch_idx on public.crm_tasks(branch);

alter table public.crm_tasks enable row level security;

comment on table public.crm_tasks is 'Shared accountable work queue for sales, operations, customer care, and partnerships.';
