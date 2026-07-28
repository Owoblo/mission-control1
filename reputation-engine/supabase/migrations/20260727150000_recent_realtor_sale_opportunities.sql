create extension if not exists pgcrypto;

create table if not exists public.partner_sale_signals (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  listing_id text,
  mls_id text,
  address text not null,
  city text,
  region text,
  sold_detected_at timestamp with time zone,
  sold_verified_at timestamp with time zone,
  verification_status text not null default 'potential',
  verification_source text,
  verification_confidence integer,
  realtor_name text not null,
  realtor_role text,
  realtor_phone text,
  realtor_email text,
  realtor_brokerage text,
  attribution_source text,
  attribution_captured_at timestamp with time zone,
  contact_id uuid references public.market_contacts(id) on delete set null,
  company_id uuid references public.partner_companies(id) on delete set null,
  match_score integer,
  match_reasons text[] not null default '{}'::text[],
  relationship_tier text not null default 'unmatched',
  suggested_message text,
  status text not null default 'needs_review',
  reviewed_by text,
  reviewed_at timestamp with time zone,
  sent_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  dismissal_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint partner_sale_signals_event_key_unique unique (event_key),
  constraint partner_sale_signals_verification_status_check
    check (verification_status in ('potential', 'verified', 'rejected')),
  constraint partner_sale_signals_status_check
    check (status in ('needs_verification', 'needs_match', 'needs_review', 'ready', 'scheduled', 'sent', 'dismissed'))
);

create index if not exists partner_sale_signals_status_idx
  on public.partner_sale_signals(status, sold_verified_at desc);
create index if not exists partner_sale_signals_contact_idx
  on public.partner_sale_signals(contact_id, sold_verified_at desc);
create index if not exists partner_sale_signals_city_idx
  on public.partner_sale_signals(city, sold_verified_at desc);

drop trigger if exists partner_sale_signals_touch_updated_at on public.partner_sale_signals;
create trigger partner_sale_signals_touch_updated_at
before update on public.partner_sale_signals
for each row execute function public.touch_partner_company_updated_at();

alter table public.partner_sale_signals enable row level security;
