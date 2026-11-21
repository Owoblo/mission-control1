-- Preserve enqueue_prepared_sms identity/duplicate semantics while avoiding
-- repeated full CRM scans for each recipient in an atomic prepared campaign.
-- Non-unique indexes: existing duplicate identities must remain detectable.
set local lock_timeout = '5s';
create index if not exists market_contacts_sms_phone_identity_idx
 on public.market_contacts ((right(regexp_replace(coalesce(phone,''),'\D','','g'),10)));
create index if not exists market_contacts_sms_name_identity_idx
 on public.market_contacts ((lower(trim(name))));
create index if not exists market_contacts_sms_company_identity_idx
 on public.market_contacts ((lower(trim(company))));
