-- Inbox reads and action-state updates are not new customer communications.
-- Keep the original immutable snapshot stable across later claimed/read updates.
create or replace function public.crm_capture_inbound_snapshot() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform capture_crm_interaction('legacy-inbound:'||new.id,
 jsonb_build_object('source',new.source,'channel',case when new.source like '%sms%' then 'sms' when new.source like '%call%' then 'call' when new.source like '%email%' then 'email' else 'web_form' end,'sender',coalesce(new.phone,new.email),'body',new.message,'occurredAt',new.created_at,'raw',to_jsonb(new),'inboundId',new.id),
 jsonb_build_object('actor','unknown','intent','unknown','disposition','lead_candidate','confidence',0,'reason','Intake snapshot; requires classification'));
 return new;
end $$;
drop trigger if exists crm_capture_inbound on public.inbound_leads;
create trigger crm_capture_inbound after insert on public.inbound_leads for each row execute function public.crm_capture_inbound_snapshot();
notify pgrst, 'reload schema';
