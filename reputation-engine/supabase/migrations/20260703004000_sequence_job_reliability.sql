alter table if exists public.sequence_jobs
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists locked_at timestamptz,
  add column if not exists last_error text;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'sequence_jobs'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.sequence_jobs drop constraint %I', constraint_record.conname);
  end loop;
end $$;

alter table if exists public.sequence_jobs
  add constraint sequence_jobs_status_check
  check (status in ('pending', 'running', 'sent', 'failed', 'cancelled', 'queued_manual'));

create index if not exists sequence_jobs_due_idx
  on public.sequence_jobs(status, scheduled_at)
  where status in ('pending', 'running');

create index if not exists sequence_jobs_locked_at_idx
  on public.sequence_jobs(locked_at)
  where status = 'running';
