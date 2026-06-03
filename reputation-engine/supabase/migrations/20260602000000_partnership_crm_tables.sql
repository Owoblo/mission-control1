-- Custom contact lists
create table if not exists public.market_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  tier integer check (tier in (1, 2, 3)),
  color text default 'slate',
  created_by text,
  created_at timestamptz not null default now()
);

-- Junction: contact <-> list
create table if not exists public.market_list_contacts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.market_lists(id) on delete cascade,
  contact_id uuid not null references public.market_contacts(id) on delete cascade,
  added_by text,
  added_at timestamptz not null default now(),
  unique(list_id, contact_id)
);

-- Appointments per contact
create table if not exists public.market_appointments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.market_contacts(id) on delete cascade,
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30,
  channel text not null default 'phone',
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_by text,
  created_at timestamptz not null default now()
);

-- Add new fields to market_contacts
alter table public.market_contacts
  add column if not exists outreach_tier integer check (outreach_tier in (1, 2, 3)),
  add column if not exists instantly_lead_id text,
  add column if not exists instantly_campaign_id text,
  add column if not exists instantly_status text;

-- Indexes
create index if not exists market_list_contacts_list_id_idx on public.market_list_contacts(list_id);
create index if not exists market_list_contacts_contact_id_idx on public.market_list_contacts(contact_id);
create index if not exists market_appointments_contact_id_idx on public.market_appointments(contact_id);
create index if not exists market_appointments_scheduled_at_idx on public.market_appointments(scheduled_at);
create index if not exists market_contacts_outreach_tier_idx on public.market_contacts(outreach_tier);
