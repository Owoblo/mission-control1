create table public.partnership_handoff_cursor (
  worker text primary key,
  touched_at timestamptz,
  touch_id uuid
);
insert into public.partnership_handoff_cursor(worker) values ('inbound_sms');
alter table public.partnership_handoff_cursor enable row level security;
revoke all on public.partnership_handoff_cursor from public,anon,authenticated;
grant select, update on public.partnership_handoff_cursor to service_role;
create index if not exists partnership_inbound_sms_cursor_idx on public.market_touches(created_at,id) where channel='sms' and direction='inbound';
create index if not exists partnership_lead_referrer_idx on public.crm_leads ((data->>'partnerReferralContactId'));
create index if not exists partnership_lead_email_idx on public.crm_leads (lower(data->>'email'));
create index if not exists partnership_lead_phone_idx on public.crm_leads (right(regexp_replace(data->>'phone','[^0-9]','','g'),10));

create function public.create_partnership_handoff(p_id text,p_contact uuid,p_data jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('partnership-handoff',0));
  if exists(select 1 from public.crm_leads where id=p_id or data->>'partnerReferralContactId'=p_contact::text
    or (nullif(p_data->>'email','') is not null and lower(data->>'email')=lower(p_data->>'email'))
    or (length(regexp_replace(p_data->>'phone','[^0-9]','','g'))>=10 and right(regexp_replace(data->>'phone','[^0-9]','','g'),10)=right(regexp_replace(p_data->>'phone','[^0-9]','','g'),10)))
    then return false; end if;
  insert into public.crm_leads(id,data,deleted,updated_at) values(p_id,p_data,false,now());
  update public.market_contacts set priority=p_data->>'partnerLeadPriority',sequence_paused=true,sequence_paused_reason='live_sales_lead_detected' where id=p_contact;
  return true;
end $$;
revoke all on function public.create_partnership_handoff(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_partnership_handoff(text,uuid,jsonb) to service_role;

-- Inserts can arrive behind an event-time cursor (imports or delayed commits).
create table public.partnership_handoff_arrivals (
 touch_id uuid primary key references public.market_touches(id) on delete cascade,
 received_at timestamptz not null default clock_timestamp()
);
create index partnership_handoff_arrival_order on public.partnership_handoff_arrivals(received_at,touch_id);
alter table public.partnership_handoff_arrivals enable row level security;
revoke all on public.partnership_handoff_arrivals from public,anon,authenticated;
grant select,delete on public.partnership_handoff_arrivals to service_role;
create function public.capture_partnership_handoff_arrival() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.partnership_handoff_arrivals(touch_id) values(new.id) on conflict do nothing;
 return new;
end $$;
revoke all on function public.capture_partnership_handoff_arrival() from public,anon,authenticated;
create trigger partnership_handoff_arrival after insert on public.market_touches for each row
 when(new.direction='inbound' and new.channel='sms') execute function public.capture_partnership_handoff_arrival();
