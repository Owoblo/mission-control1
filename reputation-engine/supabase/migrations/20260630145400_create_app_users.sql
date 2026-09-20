-- Baseline reconstruction for app_users.
--
-- The table existed in production but was never created by any repo
-- migration; later migrations only ALTER it (first: 20260630145500).
-- Without this file, a fresh database fails on those ALTERs.
--
-- Reconstructed from the live production schema on 2026-09-20 (read-only).
-- The role CHECK constraint is managed by 20260630145500 and intentionally
-- left to that migration. Foreign keys to partner tables are added by
-- 20260811120000, not here.
--
-- NOT APPLIED to production. Review before running anywhere.

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null,
  role text not null,
  created_at timestamptz default now(),
  branch text,
  partner_id uuid,
  partner_member_id uuid,
  constraint app_users_email_key unique (email)
);

create index if not exists app_users_partner_idx
  on public.app_users (partner_id)
  where partner_id is not null;
