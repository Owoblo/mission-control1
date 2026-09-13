-- Listing-activity review is intentionally read-first: discovery data is
-- imported by research jobs, while CRM contact creation remains a manual,
-- paused action in the application.

create table if not exists public.partner_listing_activity (
  activity_key text primary key,
  property_key text not null,
  representative_key text not null,
  representative jsonb not null default '{}',
  address text not null,
  city text not null,
  lane text not null,
  listing_status text not null default 'observed',
  status_evidence text not null default 'observed',
  observed_at timestamptz not null default now(),
  source_url text,
  postcard_batch_id text,
  postcard_status text,
  contact_id uuid references public.market_contacts(id) on delete set null,
  match_status text not null default 'new',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_listing_activity_representative_idx
  on public.partner_listing_activity(representative_key, observed_at desc);
create index if not exists partner_listing_activity_contact_idx
  on public.partner_listing_activity(contact_id, observed_at desc);
create index if not exists partner_listing_activity_lane_idx
  on public.partner_listing_activity(lane, observed_at desc);
create index if not exists partner_listing_activity_property_idx
  on public.partner_listing_activity(property_key, observed_at desc);

create table if not exists public.partner_listing_research (
  property_key text primary key,
  listing jsonb not null default '{}',
  status text not null default 'pending',
  last_error text,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_listing_research_status_idx
  on public.partner_listing_research(status, property_key);

create table if not exists public.pipeline_assessments (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  lane text not null,
  region text,
  observed_at timestamptz not null default now(),
  report jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(run_id, lane, region)
);

create index if not exists pipeline_assessments_observed_idx
  on public.pipeline_assessments(observed_at desc);
