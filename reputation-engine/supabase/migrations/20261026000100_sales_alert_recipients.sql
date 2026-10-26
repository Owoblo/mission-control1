-- Resolve future sales alert recipients from the current staff roster.
-- No historical alerts are replayed and no staff/customer records are changed.
create or replace function public.crm_sales_alert_recipients(p_branch text default null)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(email order by email),'[]'::jsonb) from (
  select 'business@starmovers.ca'::text email
  union
  select lower(trim(email)) from public.app_users
  where role in ('manager','sales_rep') and nullif(trim(email),'') is not null
    and (nullif(branch,'') is null or branch=nullif(p_branch,''))
 ) recipients;
$$;
revoke all on function public.crm_sales_alert_recipients(text) from public,anon,authenticated;
grant execute on function public.crm_sales_alert_recipients(text) to service_role;

create or replace function public.project_crm_sms_delivery(p_key text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.crm_sms_provider_events; m public.sms_messages; l public.crm_leads; error_text text; event_key text; stamp text;
begin
 perform pg_advisory_xact_lock(hashtextextended('sms-delivery:'||p_key,0));
 select * into e from public.crm_sms_provider_events where message_key=p_key
 order by public.crm_sms_status_rank(status) desc,occurred_at desc,event_id desc limit 1;
 if not found then return;end if;
 error_text:=nullif(concat_ws(' — ',e.payload#>>'{errors,0,code}',e.payload#>>'{errors,0,detail}'),'');
 update public.sms_messages set delivery_status=e.status,delivery_error=error_text,delivery_updated_at=e.occurred_at
 where twilio_sid=p_key and (delivery_updated_at is null or public.crm_sms_status_rank(e.status)>public.crm_sms_status_rank(delivery_status) or e.occurred_at>=delivery_updated_at);
 if e.status not in ('failed','undelivered','delivery_failed','sending_failed') or current_setting('crm.quiet_backfill',true)='on' then return;end if;
 for m in select * from public.sms_messages where twilio_sid=p_key and direction='outbound' and lead_id is not null loop
  select * into l from public.crm_leads where id=m.lead_id and not deleted;
  if not found or l.data->>'stage' in ('lost','completed','customer_success') then continue;end if;
  event_key:='sms-delivery-failed:'||p_key;stamp:=to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  update public.crm_leads set data=data||jsonb_build_object('deliveryFailureReview',jsonb_build_object('messageKey',p_key,'status','open','occurredAt',stamp))||case when coalesce(data->>'automationStatus','')<>'do_not_contact' then jsonb_build_object('automationStatus','handoff','automationHandoffReason','Customer SMS delivery failed; a representative must verify contact.') else '{}'::jsonb end,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=l.id and not (coalesce(data#>>'{deliveryFailureReview,messageKey}','')=p_key and coalesce(data#>>'{deliveryFailureReview,status}','')='resolved');
  insert into public.crm_followup_logs(id,data,deleted) values('fu_delivery_'||md5(p_key),jsonb_build_object('id','fu_delivery_'||md5(p_key),'leadId',l.id,'type','note','date',stamp,'createdAt',stamp,'notes','[SYSTEM ALERT][critical] Customer SMS was not delivered'||chr(10)||'Call the customer or verify the number. Carrier: '||coalesce(error_text,e.status)||'. Message reference: '||p_key),false) on conflict do nothing;
  insert into public.crm_tasks(id,title,description,status,priority,category,due_at,owner_user_id,owner_name,branch,related_type,related_id,related_label,source,source_key)
  values('task_delivery_'||md5(p_key),'Customer SMS was not delivered','Call the customer or verify the number. Do not assume they received the automated response. Message reference: '||p_key,'open','urgent','communications',e.occurred_at,nullif(l.data->>'assignedRepUserId',''),coalesce(l.data->>'assignedRepName',l.data->>'assignedRep'),l.data->>'branch','lead',l.id,l.data->>'name','condition',event_key) on conflict(source_key) do nothing;
  perform public.enqueue_internal_alert(event_key,jsonb_build_object('subject','Customer SMS delivery failed — '||coalesce(l.data->>'name','Unknown caller'),'html','<p>An SMS to '||public.crm_html_escape(l.data->>'name')||' was not delivered. Call the customer or verify their number.</p><p><a href="https://go.quote2move.com/sales/inbox">Open sales inbox</a></p>','recipients',public.crm_sales_alert_recipients(l.data->>'branch')));
 end loop;
end $$;

create or replace function public.crm_website_intake_alert() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare label text; event_key text;
begin
 if new.source<>'website_form' or coalesce(new.raw_data->>'healthCheck','false')='true' or coalesce(new.raw_data->>'health_check','false')='true' then return new;end if;
 label:=coalesce(nullif(new.name,''),nullif(new.phone,''),'New customer');
 event_key:='website-intake:'||coalesce(nullif(new.raw_data->>'inquiry_id',''),new.id::text);
 perform public.enqueue_internal_alert(event_key,jsonb_build_object('subject','New website enquiry — '||regexp_replace(label,'[\r\n]',' ','g'),'html','<p>New website enquiry from '||public.crm_html_escape(label)||'.</p><p>Phone: '||public.crm_html_escape(new.phone)||'</p><p>'||public.crm_html_escape(new.message)||'</p><p><a href="https://go.quote2move.com/sales/inbox">Open sales inbox</a></p>','recipients',public.crm_sales_alert_recipients(new.raw_data->>'branch')));
 return new;
end $$;

