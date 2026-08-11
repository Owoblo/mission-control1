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
  service_tags text[] not null default '{}'::text[],
  truck_sizes text[] not null default '{}'::text[],
  max_crew_size integer,
  insured boolean not null default false,
  insurance_expires_at date,
  availability_notes text,
  completed_jobs integer not null default 0,
  cancelled_jobs integer not null default 0,
  average_rating numeric(3,2),
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
  arrival_window text,
  origin_city text not null,
  destination_city text not null,
  distance_km numeric,
  estimated_hours_min numeric,
  estimated_hours_max numeric,
  suggested_truck text,
  crew_size integer,
  required_service_tags text[] not null default '{}'::text[],
  inventory jsonb not null default '[]'::jsonb,
  access_summary jsonb not null default '{}'::jsonb,
  scope_notes text,
  offered_payout numeric(12,2) not null check (offered_payout > 0),
  currency text not null default 'CAD',
  status text not null default 'draft'
    check (status in ('draft', 'open', 'awarded', 'cancelled', 'expired')),
  expires_at timestamptz,
  award_policy text not null default 'first_acceptance'
    check (award_policy in ('first_acceptance', 'manual_selection')),
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
create or replace function public.respond_to_subcontractor_offer(p_token uuid, p_action text, p_note text default null)
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
  if p_action not in ('accept', 'decline', 'discussion', 'view') then
    raise exception 'Invalid offer response action';
  end if;

  select * into v_rec
  from public.subcontractor_offer_recipients
  where token = p_token
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if p_action = 'view' then
    update public.subcontractor_offer_recipients
    set status = case when status in ('pending', 'sent') then 'viewed' else status end,
        viewed_at = coalesce(viewed_at, now()), updated_at = now()
    where id = v_rec.id;
    return query select 'viewed'::text, v_rec.offer_id, v_rec.subcontractor_id, null::uuid;
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

  if p_action in ('decline', 'discussion') then
    update public.subcontractor_offer_recipients
    set status = p_action, response_note = nullif(trim(coalesce(p_note, '')), ''),
        responded_at = now(), updated_at = now()
    where id = v_rec.id;
    return query select p_action, v_offer.id, v_rec.subcontractor_id, v_offer.awarded_subcontractor_id;
    return;
  end if;

  if v_offer.award_policy = 'manual_selection' then
    update public.subcontractor_offer_recipients
    set status = 'discussion', response_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Available — awaiting dispatcher award'),
        responded_at = now(), updated_at = now()
    where id = v_rec.id;
    return query select 'available'::text, v_offer.id, v_rec.subcontractor_id, null::uuid;
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
revoke all on function public.respond_to_subcontractor_offer(uuid, text, text) from public;
grant execute on function public.respond_to_subcontractor_offer(uuid, text, text) to service_role;

create or replace function public.award_subcontractor_offer(p_offer_id uuid, p_subcontractor_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.subcontractor_offers
  set status = 'awarded', awarded_subcontractor_id = p_subcontractor_id,
      awarded_at = now(), updated_at = now()
  where id = p_offer_id and status = 'open'
    and (expires_at is null or expires_at > now())
    and exists (select 1 from public.subcontractor_offer_recipients where offer_id = p_offer_id and subcontractor_id = p_subcontractor_id);
  if not found then return false; end if;
  update public.subcontractor_offer_recipients
  set status = case when subcontractor_id = p_subcontractor_id then 'accepted' else 'not_awarded' end,
      responded_at = case when subcontractor_id = p_subcontractor_id then now() else responded_at end,
      updated_at = now()
  where offer_id = p_offer_id and status not in ('declined');
  return true;
end;
$$;
revoke all on function public.award_subcontractor_offer(uuid, uuid) from public;
grant execute on function public.award_subcontractor_offer(uuid, uuid) to service_role;
