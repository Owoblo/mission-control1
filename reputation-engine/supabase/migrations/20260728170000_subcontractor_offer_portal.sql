create extension if not exists pgcrypto;

create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text not null,
  phone text not null,
  email text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'blocked')),
  branches text[] not null default '{}'::text[],
  service_cities text[] not null default '{}'::text[],
  truck_sizes text[] not null default '{}'::text[],
  max_crew_size integer,
  insured boolean not null default false,
  insurance_expires_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subcontractors_phone_unique
  on public.subcontractors (phone);

create table if not exists public.subcontractor_offers (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  quote_id text,
  branch text,
  move_date date,
  origin_city text not null,
  destination_city text not null,
  distance_km numeric,
  estimated_hours_min numeric,
  estimated_hours_max numeric,
  suggested_truck text,
  crew_size integer,
  inventory jsonb not null default '[]'::jsonb,
  access_summary jsonb not null default '{}'::jsonb,
  scope_notes text,
  offered_payout numeric(12,2) not null check (offered_payout > 0),
  currency text not null default 'CAD',
  status text not null default 'draft'
    check (status in ('draft', 'open', 'awarded', 'cancelled', 'expired')),
  expires_at timestamptz,
  awarded_subcontractor_id uuid references public.subcontractors(id) on delete set null,
  awarded_at timestamptz,
  created_by_user_id text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subcontractor_offer_recipients (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.subcontractor_offers(id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'accepted', 'declined', 'discussion', 'not_awarded', 'send_failed')),
  sent_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  response_note text,
  sms_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, subcontractor_id),
  unique (token)
);

create index if not exists subcontractor_offers_status_idx
  on public.subcontractor_offers (status, move_date);
create index if not exists subcontractor_offer_recipients_offer_idx
  on public.subcontractor_offer_recipients (offer_id, status);

alter table public.subcontractors enable row level security;
alter table public.subcontractor_offers enable row level security;
alter table public.subcontractor_offer_recipients enable row level security;

create or replace function public.accept_subcontractor_offer(p_token uuid)
returns table (
  outcome text,
  offer_id uuid,
  subcontractor_id uuid,
  awarded_subcontractor_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.subcontractor_offer_recipients%rowtype;
  v_offer public.subcontractor_offers%rowtype;
begin
  select * into v_rec
  from public.subcontractor_offer_recipients
  where token = p_token
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select * into v_offer
  from public.subcontractor_offers
  where id = v_rec.offer_id
  for update;

  if v_offer.status = 'awarded' then
    return query select
      case when v_offer.awarded_subcontractor_id = v_rec.subcontractor_id then 'accepted' else 'already_awarded' end,
      v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id;
    return;
  end if;

  if v_offer.status <> 'open' or (v_offer.expires_at is not null and v_offer.expires_at <= now()) then
    return query select 'closed'::text, v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id;
    return;
  end if;

  update public.subcontractor_offers
  set status = 'awarded',
      awarded_subcontractor_id = v_rec.subcontractor_id,
      awarded_at = now(),
      updated_at = now()
  where id = v_offer.id;

  update public.subcontractor_offer_recipients
  set status = case when subcontractor_id = v_rec.subcontractor_id then 'accepted' else 'not_awarded' end,
      responded_at = case when subcontractor_id = v_rec.subcontractor_id then now() else responded_at end,
      updated_at = now()
  where offer_id = v_offer.id
    and status not in ('declined', 'discussion');

  return query select 'accepted'::text, v_offer.id, v_rec.subcontractor_id, v_rec.subcontractor_id;
end;
$$;

revoke all on function public.accept_subcontractor_offer(uuid) from public;
grant execute on function public.accept_subcontractor_offer(uuid) to service_role;
