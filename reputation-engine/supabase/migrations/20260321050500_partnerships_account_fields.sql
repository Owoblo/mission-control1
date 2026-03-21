alter table if exists public.market_contacts
  add column if not exists owner_name text,
  add column if not exists owner_email text,
  add column if not exists priority text not null default 'normal',
  add column if not exists account_status text not null default 'active',
  add column if not exists mailed_at timestamp with time zone,
  add column if not exists mailed_by text,
  add column if not exists meeting_booked_at timestamp with time zone,
  add column if not exists partnership_outcome text,
  add column if not exists partnership_outcome_at timestamp with time zone,
  add column if not exists partnership_started_at timestamp with time zone,
  add column if not exists last_inbound_at timestamp with time zone,
  add column if not exists referred_lead_count integer not null default 0;

alter table if exists public.market_touches
  add column if not exists outcome_code text,
  add column if not exists next_step text,
  add column if not exists next_follow_up_on date,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.market_queue
  add column if not exists assigned_to text,
  add column if not exists completed_by text,
  add column if not exists priority text not null default 'normal';

alter table if exists public.market_signals
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamp with time zone,
  add column if not exists converted_contact_id uuid,
  add column if not exists converted_at timestamp with time zone;

update public.market_contacts c
set mailed_at = mail.last_mail_at
from (
  select contact_id, max(created_at) as last_mail_at
  from public.market_touches
  where channel = 'direct_mail'
  group by contact_id
) as mail
where c.id = mail.contact_id
  and c.mailed_at is null;

update public.market_contacts
set partnership_outcome = 'secured',
    partnership_outcome_at = coalesce(partnership_outcome_at, last_touch_at, created_at),
    partnership_started_at = coalesce(partnership_started_at, last_touch_at, created_at)
where partnership_outcome is null
  and stage in ('partnership_active', 'partnered', 'referring');

update public.market_contacts
set account_status = case
  when stage in ('closed_lost', 'dnc') then 'closed'
  when stage in ('dormant', 'revisit') then 'dormant'
  else 'active'
end
where account_status is null
   or account_status = '';
