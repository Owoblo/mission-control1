-- Serialize call intake and missed-call responses across serverless instances.
create index if not exists inbound_call_provider_id on public.inbound_leads ((raw_data->>'callSid')) where source='twilio_call';
create index if not exists crm_interaction_sender_phone on public.crm_interactions ((regexp_replace(event->>'sender','[^0-9]','','g')));

create or replace function public.capture_inbound_call(p_id uuid,p_phone text,p_message text,p_raw jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare existing_id uuid; call_id text:=nullif(p_raw->>'callSid','');
begin
 if call_id is null then raise exception 'Provider call ID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inbound-call:'||call_id,0));
 select id into existing_id from public.inbound_leads where source='twilio_call' and raw_data->>'callSid'=call_id
 order by (raw_data ? 'linkedLeadId') desc,claimed desc,created_at asc limit 1 for update;
 if existing_id is null then
  existing_id:=p_id;
  insert into public.inbound_leads(id,source,phone,message,raw_data,claimed,created_at)
  values(existing_id,'twilio_call',p_phone,p_message,p_raw,false,clock_timestamp());
 else
  -- Preserve claimed state, the original arrival time, SMS replies and inbox actions.
  update public.inbound_leads set raw_data=coalesce(raw_data,'{}')||p_raw where id=existing_id;
 end if;
 return existing_id;
end $$;

create table if not exists public.crm_missed_call_responses (
 call_sid text primary key,phone text not null,business_number text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists missed_call_response_contact on public.crm_missed_call_responses(phone,business_number,created_at desc);
alter table public.crm_missed_call_responses enable row level security;
revoke all on public.crm_missed_call_responses from public,anon,authenticated;
grant select,insert on public.crm_missed_call_responses to service_role;

create or replace function public.reserve_missed_call_response(p_phone text,p_business text,p_call text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if nullif(p_call,'') is null or nullif(p_phone,'') is null or nullif(p_business,'') is null then raise exception 'Call identity required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('missed-call:'||p_phone||':'||p_business,0));
 if exists(select 1 from public.crm_missed_call_responses where call_sid=p_call or (phone=p_phone and business_number=p_business and created_at>clock_timestamp()-interval '5 minutes'))
 or exists(select 1 from public.sms_messages where direction='outbound' and to_number=p_phone and from_number=p_business and created_at>clock_timestamp()-interval '5 minutes') then return false; end if;
 insert into public.crm_missed_call_responses(call_sid,phone,business_number) values(p_call,p_phone,p_business);
 return true;
end $$;

create or replace function public.merge_crm_inbound_call(p_lead text,p_entry jsonb,p_branch text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare current_data jsonb; logs jsonb; merged jsonb:='[]'; item jsonb; target_id text; matched boolean:=false; call_id text:=p_entry->>'callSid';
begin
 if nullif(call_id,'') is null or p_entry->>'direction'<>'inbound' then raise exception 'Inbound call required'; end if;
 select data into current_data from public.crm_leads where id=p_lead and not deleted for update;
 if current_data is null then raise exception 'Lead not found'; end if;
 logs:=coalesce(current_data->'callLogs','[]');
 for item in select value from jsonb_array_elements(logs) loop
  if item->>'callSid'=call_id and not matched then
   -- Current recording/transcript/rep edits win over a stale ingress snapshot.
   target_id:=item->>'id';
   item:=p_entry||item||jsonb_build_object('date',least(item->>'date',p_entry->>'date'));
   if p_entry->>'isVoicemail'='true' then
    item:=item||jsonb_build_object('isVoicemail',true);
    if not (item ? 'recordingSid') then item:=item||(p_entry-'id'); end if;
    if coalesce(item->>'notes','') like 'Inbound call%' then item:=item||jsonb_build_object('notes',p_entry->>'notes'); end if;
   elsif coalesce(item->>'notes','') like 'Inbound call%' and coalesce(item->>'isVoicemail','false')<>'true' then
    item:=item||jsonb_build_object('notes',p_entry->>'notes');
   end if;
   matched:=true;
  end if;
  merged:=merged||jsonb_build_array(item);
 end loop;
 if not matched then merged:=merged||jsonb_build_array(p_entry);target_id:=p_entry->>'id'; end if;
 update public.crm_leads set data=current_data||jsonb_build_object('callLogs',merged)||
  case when nullif(current_data->>'branch','') is null and p_branch in ('toronto','windsor','london','ottawa','waterloo') then jsonb_build_object('branch',p_branch) else '{}'::jsonb end,
  updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_lead;
 insert into public.crm_call_sids(call_sid,lead_id,call_log_id) values(call_id,p_lead,target_id)
 on conflict(call_sid) do update set lead_id=excluded.lead_id,call_log_id=excluded.call_log_id;
 return target_id;
end $$;

create or replace function public.list_crm_inbound_call_events(p_lead text)
returns table(id text,event jsonb) language sql stable security definer set search_path=public,pg_temp as $$
 select i.id,i.event from public.crm_interactions i
 where i.event->>'source' in ('twilio_call','twilio_missed_call','twilio_voicemail') and (
  exists(select 1 from public.crm_interaction_links l where l.lead_id=p_lead and l.interaction_id=i.id)
  or regexp_replace(i.event->>'sender','[^0-9]','','g') in (
   select regexp_replace(phone,'[^0-9]','','g') from public.crm_leads l,
   lateral (values(l.data->>'phone'),(l.data->>'identityPhone')) p(phone)
   where l.id=p_lead and not l.deleted and length(regexp_replace(phone,'[^0-9]','','g'))>=10
  )
 ) order by i.event->>'occurredAt',i.id;
$$;

revoke all on function public.capture_inbound_call(uuid,text,text,jsonb),public.reserve_missed_call_response(text,text,text),public.merge_crm_inbound_call(text,jsonb,text),public.list_crm_inbound_call_events(text) from public,anon,authenticated;
grant execute on function public.capture_inbound_call(uuid,text,text,jsonb),public.reserve_missed_call_response(text,text,text),public.merge_crm_inbound_call(text,jsonb,text),public.list_crm_inbound_call_events(text) to service_role;
