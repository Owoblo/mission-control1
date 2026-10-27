-- Preserve website evidence while preventing a known earnings-link campaign from
-- producing customer automation or forwarding arbitrary form content by email.
create function public.crm_website_spam_reason(p_source text,p_message text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select case when p_source in ('website_form','website-form','website-discovery','website_discovery') and coalesce(p_message,'') ~* 'https?://(www[.])?telegra[.]ph/Read-the-latest-news-and-earn-50000000-in-a-month'
 then 'Known earnings-link spam campaign; human review required' end
$$;

create function public.crm_hold_website_submission() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text;
begin
 reason:=public.crm_website_spam_reason(new.source,concat_ws(' ',new.message,new.raw_data->>'message'));
 if reason is null then return new;end if;
 new.raw_data:=coalesce(new.raw_data,'{}')||jsonb_build_object('inboxDisposition','junk','websiteSpamReview',jsonb_build_object('rule','earnings_link_v1','reason',reason,'detectedAt',now(),'state','held'));
 new.claimed:=true;new.claimed_at:=coalesce(new.claimed_at,now());
 return new;
end $$;
create trigger crm_hold_website_submission before insert on public.inbound_leads for each row execute function public.crm_hold_website_submission();

create or replace function public.crm_website_intake_alert() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare event_key text;
begin
 if new.source<>'website_form' or coalesce(new.raw_data->>'healthCheck','false')='true' or coalesce(new.raw_data->>'health_check','false')='true' then return new;end if;
 if public.crm_website_spam_reason(new.source,concat_ws(' ',new.message,new.raw_data->>'message')) is not null then
  insert into analytics_events(id,event_type,ts,created_at,properties) values('website-spam:'||new.id,'website_submission_held',now(),now(),jsonb_build_object('inboundId',new.id,'rule','earnings_link_v1','evidenceSource','database_content_guard','state','held')) on conflict do nothing;
  return new;
 end if;
 event_key:='website-intake:'||coalesce(nullif(new.raw_data->>'inquiry_id',''),new.id::text);
 -- Even an unrecognized attack cannot make our notification relay its links,
 -- text, markup, contact details, or subject. The original remains in the CRM.
 perform public.enqueue_internal_alert(event_key,jsonb_build_object('subject','New website enquiry','html','<p>A new website enquiry was received.</p><p>Review the customer details and request in the sales inbox before contacting the sender.</p><p><a href="https://go.quote2move.com/sales/inbox">Open sales inbox</a></p>','recipients',public.crm_sales_alert_recipients(new.raw_data->>'branch')));
 return new;
end $$;

create function public.crm_hold_website_automation_job() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text;
begin
 reason:=public.crm_website_spam_reason(new.payload->>'source',new.payload->>'message');
 if reason is null or new.status not in ('pending','running') then return new;end if;
 new.status:='cancelled';new.last_error:=reason;new.locked_at:=null;
 update crm_leads set data=data||jsonb_build_object('automationStatus','handoff','automationHandoffReason',reason,'websiteSpamReview',jsonb_build_object('rule','earnings_link_v1','state','held','detectedAt',now())),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=new.lead_id and not deleted;
 return new;
end $$;
create trigger crm_hold_website_automation_job before insert or update of payload,status on public.crm_automation_jobs for each row execute function public.crm_hold_website_automation_job();

-- Reconcile only this observed campaign. Do not delete evidence or classify by
-- customer name, nationality, phone prefix, an old date, or an ordinary URL.
do $$ declare r record; reason text;begin
 for r in select id,raw_data,message,source from inbound_leads where public.crm_website_spam_reason(source,concat_ws(' ',message,raw_data->>'message')) is not null loop
  reason:=public.crm_website_spam_reason(r.source,concat_ws(' ',r.message,r.raw_data->>'message'));
  update inbound_leads set claimed=true,claimed_at=coalesce(claimed_at,now()),raw_data=coalesce(raw_data,'{}')||jsonb_build_object('inboxDisposition','junk','websiteSpamReview',jsonb_build_object('rule','earnings_link_v1','reason',reason,'detectedAt',now(),'state','held')) where id=r.id;
  insert into analytics_events(id,event_type,ts,created_at,properties) values('website-spam:'||r.id,'website_submission_held',now(),now(),jsonb_build_object('inboundId',r.id,'rule','earnings_link_v1','evidenceSource','migration_content_guard','state','held')) on conflict do nothing;
  update crm_leads set data=data||jsonb_build_object('automationStatus','handoff','automationHandoffReason',reason,'websiteSpamReview',jsonb_build_object('rule','earnings_link_v1','state','held','inboundId',r.id,'detectedAt',now())),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=r.raw_data->>'linkedLeadId' and not deleted;
  update crm_automation_jobs set status='cancelled',last_error=reason,locked_at=null,updated_at=now() where lead_id=r.raw_data->>'linkedLeadId' and status='pending';
  update crm_alert_outbox set state='failed',last_error=reason,updated_at=now() where event_key='website-intake:'||coalesce(nullif(r.raw_data->>'inquiry_id',''),r.id::text) and state='pending';
 end loop;
end $$;
revoke all on function crm_website_spam_reason(text,text),crm_hold_website_submission(),crm_hold_website_automation_job() from public,anon,authenticated;
grant execute on function crm_website_spam_reason(text,text) to service_role;
