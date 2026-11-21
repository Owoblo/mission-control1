begin;
create table if not exists public.operations_phone_contacts (
  phone text primary key check (phone ~ '^\+1[0-9]{10}$'),
  name text not null default '', company text not null default '',
  type text not null default 'subcontractor' check (type in ('subcontractor','vendor')),
  notes text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.operations_phone_events (
  id text primary key, phone text not null check (phone ~ '^\+1[0-9]{10}$'),
  kind text not null check (kind in ('call','sms','note')),
  direction text not null check (direction in ('inbound','outbound','internal')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists operations_phone_events_phone_date on public.operations_phone_events(phone,created_at desc);
alter table public.operations_phone_contacts enable row level security;
alter table public.operations_phone_events enable row level security;
revoke all on public.operations_phone_contacts, public.operations_phone_events from anon, authenticated;
grant all on public.operations_phone_contacts, public.operations_phone_events to service_role;
create or replace function public.save_operations_phone_event(p_id text,p_phone text,p_kind text,p_direction text,p_payload jsonb)
returns void language sql security definer set search_path=public as $$
  insert into operations_phone_events(id,phone,kind,direction,payload)
  values(p_id,p_phone,p_kind,p_direction,p_payload)
  on conflict(id) do update set payload=operations_phone_events.payload || excluded.payload ||
    case when operations_phone_events.kind='sms'
      and operations_phone_events.payload->>'status' in ('delivered','read','failed','undelivered')
      then jsonb_build_object('status',operations_phone_events.payload->>'status')
      when operations_phone_events.kind='call'
        and operations_phone_events.payload->>'status' in ('completed','voicemail')
        and coalesce(excluded.payload->>'status','') not in ('completed','voicemail')
      then jsonb_build_object('status',operations_phone_events.payload->>'status','duration',operations_phone_events.payload->'duration')
      else '{}'::jsonb end;
$$;
revoke all on function public.save_operations_phone_event(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_operations_phone_event(text,text,text,text,jsonb) to service_role;
-- Preserve the existing Operations text history without creating sales contacts.
insert into public.operations_phone_events(id,phone,kind,direction,payload,created_at)
select 'sms:' || coalesce(nullif(twilio_sid,''),id::text),
  case when from_number='+12267746581' then to_number else from_number end,
  'sms',case when from_number='+12267746581' then 'outbound' else 'inbound' end,
  jsonb_build_object('body',body,'status',case when from_number='+12267746581' then 'sent' else 'received' end),created_at
from public.sms_messages
where (from_number='+12267746581' or to_number='+12267746581')
  and (case when from_number='+12267746581' then to_number else from_number end) ~ '^\+1[0-9]{10}$'
on conflict(id) do nothing;
create or replace function public.list_operations_phone_threads()
returns setof public.operations_phone_events language sql security definer set search_path=public as $$
  select distinct on (phone) * from operations_phone_events order by phone, created_at desc, id desc;
$$;
revoke all on function public.list_operations_phone_threads() from public, anon, authenticated;
grant execute on function public.list_operations_phone_threads() to service_role;
notify pgrst, 'reload schema';
commit;
