create extension if not exists pgcrypto;

create table if not exists public.partner_companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  normalized_key text not null,
  industry text,
  address text,
  website text,
  main_phone text,
  city text,
  account_owner_user_id text,
  account_owner_name text,
  account_owner_email text,
  account_status text not null default 'active',
  partnership_potential text,
  total_referrals integer not null default 0,
  total_revenue_cents integer not null default 0,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists partner_companies_normalized_key_idx
  on public.partner_companies (normalized_key);
create index if not exists partner_companies_city_idx on public.partner_companies (city);
create index if not exists partner_companies_owner_idx on public.partner_companies (account_owner_user_id, account_owner_email);

alter table if exists public.market_contacts
  add column if not exists partner_company_id uuid references public.partner_companies(id) on delete set null,
  add column if not exists assigned_manager_user_id text,
  add column if not exists preferred_channel text,
  add column if not exists relationship_score integer not null default 0,
  add column if not exists relationship_temperature text not null default 'cold',
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists commission_rule_required boolean not null default true;

create index if not exists market_contacts_partner_company_id_idx on public.market_contacts(partner_company_id);
create index if not exists market_contacts_assigned_manager_idx on public.market_contacts(assigned_manager_user_id, owner_email);
create index if not exists market_contacts_relationship_temperature_idx on public.market_contacts(relationship_temperature);
create index if not exists market_contacts_tags_gin_idx on public.market_contacts using gin(tags);

create table if not exists public.partner_opportunities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.market_contacts(id) on delete cascade,
  company_id uuid references public.partner_companies(id) on delete set null,
  name text not null,
  city text,
  category text,
  stage text not null default 'new_opportunity',
  value_potential_cents integer,
  probability integer,
  expected_close_date date,
  assigned_manager_user_id text,
  assigned_manager_name text,
  assigned_manager_email text,
  next_action text,
  next_action_due date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists partner_opportunities_contact_idx on public.partner_opportunities(contact_id);
create index if not exists partner_opportunities_company_idx on public.partner_opportunities(company_id);
create index if not exists partner_opportunities_stage_idx on public.partner_opportunities(stage);
create index if not exists partner_opportunities_owner_idx on public.partner_opportunities(assigned_manager_user_id, assigned_manager_email);

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.market_contacts(id) on delete set null,
  company_id uuid references public.partner_companies(id) on delete set null,
  affiliate_partner_id text,
  partner_code text,
  customer_name text,
  customer_phone text,
  customer_email text,
  job_city text,
  move_date date,
  inbound_lead_id text,
  crm_lead_id text,
  job_id text,
  quoted_amount_cents integer,
  booked_amount_cents integer,
  job_status text,
  commission_rule_id text,
  commission_status text not null default 'rule_required',
  commission_owed_cents integer not null default 0,
  commission_paid_cents integer not null default 0,
  source text not null default 'partner_referral',
  proof_notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists partner_referrals_contact_idx on public.partner_referrals(contact_id);
create index if not exists partner_referrals_company_idx on public.partner_referrals(company_id);
create index if not exists partner_referrals_partner_code_idx on public.partner_referrals(partner_code);
create index if not exists partner_referrals_crm_lead_idx on public.partner_referrals(crm_lead_id);
create index if not exists partner_referrals_commission_status_idx on public.partner_referrals(commission_status);

create table if not exists public.partner_activity_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.market_contacts(id) on delete set null,
  company_id uuid references public.partner_companies(id) on delete set null,
  opportunity_id uuid references public.partner_opportunities(id) on delete set null,
  referral_id uuid references public.partner_referrals(id) on delete set null,
  actor_user_id text,
  actor_name text,
  actor_email text,
  action text not null,
  previous_value jsonb,
  next_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create index if not exists partner_activity_logs_contact_idx on public.partner_activity_logs(contact_id, created_at desc);
create index if not exists partner_activity_logs_company_idx on public.partner_activity_logs(company_id, created_at desc);
create index if not exists partner_activity_logs_action_idx on public.partner_activity_logs(action, created_at desc);

create or replace function public.partner_company_normalized_key(
  input_company text,
  input_city text,
  input_website text
) returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      lower(
        coalesce(nullif(trim(input_company), ''), 'unknown') || '|' ||
        coalesce(nullif(trim(input_city), ''), 'unknown') || '|' ||
        coalesce(
          nullif(regexp_replace(regexp_replace(lower(trim(coalesce(input_website, ''))), '^https?://', ''), '^www\.', ''), ''),
          'no_website'
        )
      ),
      '[^a-z0-9|._-]+',
      '_',
      'g'
    ),
    ''
  )
$$;

create or replace function public.touch_partner_company_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partner_companies_touch_updated_at on public.partner_companies;
create trigger partner_companies_touch_updated_at
before update on public.partner_companies
for each row execute function public.touch_partner_company_updated_at();

drop trigger if exists partner_opportunities_touch_updated_at on public.partner_opportunities;
create trigger partner_opportunities_touch_updated_at
before update on public.partner_opportunities
for each row execute function public.touch_partner_company_updated_at();

drop trigger if exists partner_referrals_touch_updated_at on public.partner_referrals;
create trigger partner_referrals_touch_updated_at
before update on public.partner_referrals
for each row execute function public.touch_partner_company_updated_at();

create or replace function public.link_market_contact_partner_company()
returns trigger
language plpgsql
as $$
declare
  company_key text;
  linked_company_id uuid;
begin
  if nullif(trim(coalesce(new.company, '')), '') is null then
    return new;
  end if;

  company_key := public.partner_company_normalized_key(new.company, new.city, new.website);

  insert into public.partner_companies (
    company_name,
    normalized_key,
    industry,
    address,
    website,
    city,
    account_owner_user_id,
    account_owner_name,
    account_owner_email
  ) values (
    trim(new.company),
    company_key,
    nullif(trim(coalesce(new.industry, '')), ''),
    nullif(trim(coalesce(new.address, '')), ''),
    nullif(trim(coalesce(new.website, '')), ''),
    nullif(trim(coalesce(new.city, '')), ''),
    nullif(trim(coalesce(new.assigned_manager_user_id, '')), ''),
    nullif(trim(coalesce(new.owner_name, '')), ''),
    nullif(trim(coalesce(new.owner_email, '')), '')
  )
  on conflict (normalized_key) do update
    set company_name = coalesce(nullif(excluded.company_name, ''), public.partner_companies.company_name),
        industry = coalesce(public.partner_companies.industry, excluded.industry),
        address = coalesce(public.partner_companies.address, excluded.address),
        website = coalesce(public.partner_companies.website, excluded.website),
        city = coalesce(public.partner_companies.city, excluded.city),
        account_owner_user_id = coalesce(public.partner_companies.account_owner_user_id, excluded.account_owner_user_id),
        account_owner_name = coalesce(public.partner_companies.account_owner_name, excluded.account_owner_name),
        account_owner_email = coalesce(public.partner_companies.account_owner_email, excluded.account_owner_email),
        updated_at = now()
  returning id into linked_company_id;

  new.partner_company_id := linked_company_id;
  return new;
end;
$$;

drop trigger if exists market_contacts_link_partner_company on public.market_contacts;
create trigger market_contacts_link_partner_company
before insert or update of company, city, website, owner_name, owner_email, assigned_manager_user_id, industry, address
on public.market_contacts
for each row execute function public.link_market_contact_partner_company();

insert into public.partner_companies (
  company_name,
  normalized_key,
  industry,
  address,
  website,
  city,
  account_owner_user_id,
  account_owner_name,
  account_owner_email,
  created_at,
  updated_at
)
select distinct on (public.partner_company_normalized_key(company, city, website))
  trim(company),
  public.partner_company_normalized_key(company, city, website),
  nullif(trim(coalesce(industry, '')), ''),
  nullif(trim(coalesce(address, '')), ''),
  nullif(trim(coalesce(website, '')), ''),
  nullif(trim(coalesce(city, '')), ''),
  nullif(trim(coalesce(assigned_manager_user_id, '')), ''),
  nullif(trim(coalesce(owner_name, '')), ''),
  nullif(trim(coalesce(owner_email, '')), ''),
  coalesce(created_at, now()),
  now()
from public.market_contacts
where nullif(trim(coalesce(company, '')), '') is not null
on conflict (normalized_key) do nothing;

update public.market_contacts contact
set partner_company_id = company.id
from public.partner_companies company
where contact.partner_company_id is null
  and nullif(trim(coalesce(contact.company, '')), '') is not null
  and company.normalized_key = public.partner_company_normalized_key(contact.company, contact.city, contact.website);
