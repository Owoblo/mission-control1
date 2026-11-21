-- Existing unlinked contacts retain automatic resolution. No historical records changed.
CREATE OR REPLACE FUNCTION public.link_market_contact_partner_company()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  company_key text;
  linked_company_id uuid;
begin
  -- Preserve explicit account identity on insert; FK validates the referenced account.
  if TG_OP = 'INSERT' and new.partner_company_id is not null then
    return new;
  end if;
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
$function$
;
