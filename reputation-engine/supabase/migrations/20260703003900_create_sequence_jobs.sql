-- Baseline reconstruction for sequence_jobs.
--
-- The table existed in production but was never created by any repo
-- migration; later migrations only ALTER it (first: 20260703004000).
-- Without this file, a fresh database fails on those ALTERs.
--
-- Reconstructed from the live production schema on 2026-09-20 (read-only).
-- Later migrations use ADD COLUMN IF NOT EXISTS, so on a fresh database they
-- become no-ops against this baseline. The foreign key to market_campaigns
-- has no repo migration coverage and is left out (see schema-gap report);
-- the contact FK is internal to the baseline market tables.
--
-- NOT APPLIED to production. Review before running anywhere.

create table if not exists public.sequence_jobs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.market_contacts (id) on delete cascade,
  batch_id uuid,
  channel text not null,
  scheduled_at timestamptz not null,
  status text default 'pending',
  sent_at timestamptz,
  template_key text,
  error text,
  created_at timestamptz default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz,
  last_error text
);

create index if not exists idx_sequence_jobs_contact on public.sequence_jobs (contact_id, status);
create index if not exists idx_sequence_jobs_pending on public.sequence_jobs (scheduled_at) where status = 'pending';
create index if not exists sequence_jobs_due_idx on public.sequence_jobs (status, scheduled_at) where status in ('pending', 'running');
