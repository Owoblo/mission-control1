create or replace function public.partner_market_from_city(input_city text)
returns text
language sql
immutable
as $$
  with normalized as (
    select regexp_replace(lower(coalesce(input_city, '')), '[^a-z0-9]+', '-', 'g') as key
  )
  select case
    when key = any(array[
      'windsor',
      'essex',
      'lasalle',
      'la-salle',
      'tecumseh',
      'lakeshore',
      'belle-river',
      'amherstburg',
      'harrow',
      'kingsville',
      'leamington',
      'stoney-point',
      'chatham',
      'chatham-kent'
    ]) then 'windsor'
    when key = any(array[
      'kitchener',
      'waterloo',
      'cambridge',
      'guelph',
      'kw',
      'k-w',
      'kwc',
      'kwg',
      'kitchener-waterloo',
      'kitchener-and-waterloo',
      'elmira',
      'st-jacobs',
      'baden',
      'new-hamburg',
      'ayr',
      'fergus',
      'elora',
      'wellington'
    ]) then 'waterloo'
    when key = any(array[
      'ottawa',
      'kanata',
      'nepean',
      'orleans',
      'barrhaven',
      'gloucester',
      'stittsville',
      'manotick',
      'gatineau'
    ]) then 'ottawa'
    when key = any(array[
      'london',
      'st-thomas',
      'strathroy',
      'woodstock',
      'stratford',
      'sarnia',
      'dorchester',
      'ingersoll',
      'komoka',
      'lambeth',
      'tillsonburg'
    ]) then 'london'
    else null
  end
  from normalized
$$;

create or replace function public.assign_partnership_manager_from_city()
returns trigger
language plpgsql
as $$
declare
  market_key text;
  manager_record record;
begin
  if coalesce(new.assigned_manager_user_id, new.owner_email, new.owner_name) is not null then
    return new;
  end if;

  market_key := public.partner_market_from_city(new.city);
  if market_key is null then
    return new;
  end if;

  select id, name, email
  into manager_record
  from public.app_users
  where role = 'partnership_manager'
    and branch = market_key
  order by created_at asc
  limit 1;

  if manager_record.id is null then
    return new;
  end if;

  new.assigned_manager_user_id := manager_record.id::text;
  new.owner_name := manager_record.name;
  new.owner_email := manager_record.email;
  return new;
end;
$$;

drop trigger if exists market_contacts_assign_partnership_manager on public.market_contacts;
create trigger market_contacts_assign_partnership_manager
before insert or update of city
on public.market_contacts
for each row execute function public.assign_partnership_manager_from_city();
