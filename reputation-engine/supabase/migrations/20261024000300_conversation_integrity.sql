-- Delivery truth, durable customer commitments, and recording processing.
alter table public.sms_messages add column if not exists delivery_status text;
alter table public.sms_messages add column if not exists delivery_error text;
alter table public.sms_messages add column if not exists delivery_updated_at timestamptz;
create index if not exists sms_message_provider_key on public.sms_messages(twilio_sid);

create or replace function public.crm_html_escape(value text) returns text language sql immutable as $$
 select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;');
$$;
create or replace function public.crm_sms_status_rank(value text) returns integer language sql immutable as $$
 select case when value in ('delivered','failed','undelivered','delivery_failed','sending_failed') then 40 when value='sent' then 20 else 10 end;
$$;

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
  perform public.enqueue_internal_alert(event_key,jsonb_build_object('subject','Customer SMS delivery failed — '||coalesce(l.data->>'name','Unknown caller'),'html','<p>An SMS to '||public.crm_html_escape(l.data->>'name')||' was not delivered. Call the customer or verify their number.</p><p><a href="https://go.quote2move.com/sales/inbox">Open sales inbox</a></p>','recipients',jsonb_build_array('business@starmovers.ca','thelma.ufot@starmovers.ca')));
 end loop;
end $$;

create or replace function public.crm_sms_delivery_event_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.project_crm_sms_delivery(new.message_key);return new;end $$;
drop trigger if exists crm_sms_delivery_event on public.crm_sms_provider_events;
create trigger crm_sms_delivery_event after insert on public.crm_sms_provider_events for each row execute function public.crm_sms_delivery_event_trigger();
create or replace function public.crm_sms_delivery_message_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.twilio_sid is not null then perform public.project_crm_sms_delivery(new.twilio_sid);end if;
 return new;
end $$;
drop trigger if exists crm_sms_delivery_message on public.sms_messages;
create trigger crm_sms_delivery_message after insert or update of twilio_sid,lead_id on public.sms_messages for each row execute function public.crm_sms_delivery_message_trigger();

create or replace function public.crm_website_intake_alert() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare label text; event_key text;
begin
 if new.source<>'website_form' or coalesce(new.raw_data->>'healthCheck','false')='true' or coalesce(new.raw_data->>'health_check','false')='true' then return new;end if;
 label:=coalesce(nullif(new.name,''),nullif(new.phone,''),'New customer');
 event_key:='website-intake:'||coalesce(nullif(new.raw_data->>'inquiry_id',''),new.id::text);
 perform public.enqueue_internal_alert(event_key,jsonb_build_object('subject','New website enquiry — '||regexp_replace(label,'[\r\n]',' ','g'),'html','<p>New website enquiry from '||public.crm_html_escape(label)||'.</p><p>Phone: '||public.crm_html_escape(new.phone)||'</p><p>'||public.crm_html_escape(new.message)||'</p><p><a href="https://go.quote2move.com/sales/inbox">Open sales inbox</a></p>','recipients',jsonb_build_array('business@starmovers.ca','thelma.ufot@starmovers.ca')));
 return new;
end $$;
drop trigger if exists crm_website_intake_alert on public.inbound_leads;
create trigger crm_website_intake_alert after insert on public.inbound_leads for each row execute function public.crm_website_intake_alert();

create table if not exists public.crm_conversation_signals (
 event_key text primary key,lead_id text not null,occurred_at timestamptz not null,signal jsonb not null,created_at timestamptz not null default now()
);
alter table public.crm_conversation_signals enable row level security;
revoke all on public.crm_conversation_signals from public,anon,authenticated;
grant select,insert on public.crm_conversation_signals to service_role;
create or replace function public.apply_crm_conversation_signal(p_lead text,p_key text,p_at timestamptz,p_signal jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; patch jsonb:='{}'; review jsonb; cb jsonb; promise jsonb; stamp text; prior_at timestamptz; prior_promises jsonb;
begin
 select data into d from public.crm_leads where id=p_lead and not deleted for update;
 if d is null then raise exception 'Lead not found';end if;
 if d->>'stage' in ('lost','completed','customer_success') then return d;end if;
 insert into public.crm_conversation_signals(event_key,lead_id,occurred_at,signal) values(p_key,p_lead,p_at,p_signal) on conflict do nothing;
 if not found then return d;end if;
 stamp:=to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 prior_at:=nullif(d->>'conversationSignalAt','')::timestamptz;
 if prior_at is not null and prior_at>p_at then return d;end if;
 if p_signal->>'kind' in ('declined','date_unconfirmed','no_active_move') then
  review:=jsonb_build_object('key',p_key,'kind',p_signal->>'kind','evidence',p_signal->>'evidence','occurredAt',stamp,'status','open');
  patch:=patch||jsonb_build_object('conversationReview',review);
  if p_signal->>'kind'='date_unconfirmed' then
   patch:=patch||jsonb_build_object('moveDateConfirmation','unconfirmed','qualificationState',coalesce(d->'qualificationState','{}')||jsonb_build_object('moveDateKnown',false,'quoteReady',false,'nextBestAction','rep_confirm_move_date'));
  end if;
  if coalesce(d->>'automationStatus','')<>'do_not_contact' then patch:=patch||jsonb_build_object('automationStatus','handoff','automationPauseReason','customer_intent_review');end if;
  update public.crm_tasks set status='cancelled',outcome_note='Superseded by a newer customer outcome or timing review',updated_at=now() where related_id=p_lead and source_key like 'customer-intent:%' and status in ('open','in_progress');
  insert into public.crm_tasks(id,title,description,status,priority,category,due_at,owner_user_id,owner_name,branch,related_type,related_id,related_label,source,source_key)
  values('task_review_'||md5(p_key),'Review customer outcome or timing',p_signal->>'evidence','open','high','customer_intent',p_at,nullif(d->>'assignedRepUserId',''),coalesce(d->>'assignedRepName',d->>'assignedRep'),d->>'branch','lead',p_lead,d->>'name','condition','customer-intent:'||p_key) on conflict(source_key) do nothing;
  insert into public.crm_followup_logs(id,data,deleted) values('fu_review_'||md5(p_key),jsonb_build_object('id','fu_review_'||md5(p_key),'leadId',p_lead,'type','note','date',stamp,'createdAt',stamp,'notes','[SYSTEM ALERT][warning] Customer outcome or timing needs review'||chr(10)||(p_signal->>'evidence')),false) on conflict do nothing;
 end if;
 if p_signal ? 'callback' then
  select coalesce(jsonb_agg(case when value->>'id' like 'promise_auto_%' and value->>'status'='open' then value||jsonb_build_object('status','cancelled','completionEvidence','Superseded by a newer customer timing request') else value end),'[]') into prior_promises from jsonb_array_elements(coalesce(d->'promises','[]'));
  update public.crm_tasks set status='cancelled',outcome_note='Superseded by a newer customer timing request',updated_at=now() where related_id=p_lead and source_key like 'customer-callback:%' and status in ('open','in_progress');
  cb:=p_signal->'callback'||jsonb_build_object('key',p_key,'evidence',p_signal->>'evidence','status','open','occurredAt',stamp);
  promise:=jsonb_build_object('id','promise_auto_'||md5(p_key),'action',case when cb->>'customerWillReply'='true' then 'Wait for the customer reply before following up' else 'Call the customer in the requested window' end,'reason',p_signal->>'evidence','channel','call','dueAt',cb->>'dueAt','intendedOutcome','Honor the customer timing request','ownerUserId',d->>'assignedRepUserId','ownerName',coalesce(d->>'assignedRepName','Saturn Star team'),'status','open','createdAt',stamp);
  patch:=patch||jsonb_build_object('callbackCommitment',cb,'promises',prior_promises||jsonb_build_array(promise),'followUpDate',cb->>'requestedDay','followUpNote',promise->>'action');
  insert into public.crm_tasks(id,title,description,status,priority,category,due_at,owner_user_id,owner_name,branch,related_type,related_id,related_label,source,source_key)
  values('task_callback_'||md5(p_key),promise->>'action',p_signal->>'evidence','open','high','callback',(cb->>'dueAt')::timestamptz,nullif(d->>'assignedRepUserId',''),coalesce(d->>'assignedRepName',d->>'assignedRep'),d->>'branch','lead',p_lead,d->>'name','condition','customer-callback:'||p_key) on conflict(source_key) do nothing;
 end if;
 patch:=patch||jsonb_build_object('conversationSignalAt',stamp);
 update public.crm_leads set data=d||patch,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_lead;
 return d||patch;
end $$;

create or replace function public.complete_crm_callback(p_lead text,p_at timestamptz,p_evidence text,p_inbound boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; cb jsonb; promises jsonb;
begin
 select data into d from public.crm_leads where id=p_lead and not deleted for update;
 cb:=d->'callbackCommitment';
 if cb->>'status'<>'open' or cb is null then return;end if;
 if not(p_inbound and cb->>'customerWillReply'='true') and p_at<(cb->>'notBefore')::timestamptz then return;end if;
 if length(coalesce(p_evidence,''))<12 then raise exception 'Callback completion evidence required';end if;
 select coalesce(jsonb_agg(case when value->>'id'='promise_auto_'||md5(cb->>'key') then value||jsonb_build_object('status','completed','completedAt',p_at,'completionEvidence',p_evidence) else value end),'[]') into promises from jsonb_array_elements(coalesce(d->'promises','[]'));
 update public.crm_leads set data=d||jsonb_build_object('callbackCommitment',cb||jsonb_build_object('status','completed'),'promises',promises),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_lead;
 update public.crm_tasks set status='completed',completed_at=p_at,outcome_note=p_evidence,updated_at=now() where source_key='customer-callback:'||(cb->>'key') and status in ('open','in_progress');
end $$;

create or replace function public.resolve_crm_communication_review(p_lead text,p_key text,p_action text,p_note text,p_actor text,p_date text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; review jsonb; patch jsonb:='{}'; stamp timestamptz:=clock_timestamp(); task_key text;
begin
 select data into d from public.crm_leads where id=p_lead and not deleted for update;
 if d is null or length(trim(coalesce(p_note,'')))<12 then raise exception 'Lead and customer evidence required';end if;
 if p_action='resolve-delivery' then
  review:=d->'deliveryFailureReview';
  if review->>'messageKey' is distinct from p_key then raise exception 'Delivery review changed; refresh';end if;
  patch:=jsonb_build_object('deliveryFailureReview',review||jsonb_build_object('status','resolved','evidence',p_note));
  task_key:='sms-delivery-failed:'||p_key;
 elsif p_action in ('confirm-date','resolve-review') then
  review:=d->'conversationReview';
  if coalesce(review->>'key','') is distinct from coalesce(p_key,'') then raise exception 'Customer review changed; refresh';end if;
  if p_action='confirm-date' then
   if p_date is null or p_date::date<(stamp at time zone 'America/Toronto')::date or to_char(p_date::date,'YYYY-MM-DD')<>p_date then raise exception 'Current or future move date required';end if;
   patch:=jsonb_build_object('moveDate',p_date,'moveDateConfirmation','confirmed');
  elsif d->>'moveDateConfirmation'='unconfirmed' then raise exception 'Confirm the move date explicitly';end if;
  if review is not null then patch:=patch||jsonb_build_object('conversationReview',review||jsonb_build_object('status','resolved','resolutionEvidence',p_note));end if;
  task_key:='customer-intent:'||p_key;
 else raise exception 'Unknown review action';end if;
 update public.crm_leads set data=d||patch,updated_at=greatest(stamp,updated_at+interval '1 microsecond') where id=p_lead;
 update public.crm_tasks set status='completed',completed_at=stamp,outcome_note=p_note,updated_at=stamp where related_id=p_lead and source_key=task_key and status in ('open','in_progress');
 insert into public.crm_followup_logs(id,data,deleted) values('fu_review_'||gen_random_uuid()::text,jsonb_build_object('leadId',p_lead,'type','note','date',stamp,'createdAt',stamp,'notes',coalesce(p_actor,'Representative')||' recorded '||p_action||coalesce(' ('||p_date||')','')||': '||p_note),false);
 return d||patch;
end $$;
revoke all on function public.resolve_crm_communication_review(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_crm_communication_review(text,text,text,text,text,text) to service_role;

alter table public.call_recordings add column if not exists transcription_status text;
alter table public.call_recordings add column if not exists transcription_error text;
create table if not exists public.crm_recording_jobs (
 recording_sid text primary key,state text not null default 'pending' check(state in ('pending','processing','retry','completed','failed')),
 attempts integer not null default 0,due_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.crm_recording_jobs enable row level security;
revoke all on public.crm_recording_jobs from public,anon,authenticated;
grant select,insert,update on public.crm_recording_jobs to service_role;
create index if not exists crm_recording_job_due on public.crm_recording_jobs(due_at) where state in ('pending','retry','processing');
create or replace function public.crm_recording_link() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare mapping public.crm_call_sids;
begin
 if new.lead_id is null then
  select * into mapping from public.crm_call_sids where call_sid=new.twilio_call_sid;
  if found then new.lead_id:=mapping.lead_id;new.call_log_id:=coalesce(new.call_log_id,mapping.call_log_id);end if;
 end if;
 if nullif(new.transcript,'') is not null then new.transcription_status:='completed';new.transcription_error:=null;
 elsif new.transcription_status is null then new.transcription_status:='pending';end if;
 return new;
end $$;
drop trigger if exists crm_recording_link on public.call_recordings;
create trigger crm_recording_link before insert or update on public.call_recordings for each row execute function public.crm_recording_link();
create or replace function public.crm_recording_queue() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_setting('crm.quiet_backfill',true)='on' then return new;end if;
 if new.recording_sid is not null and new.cloudflare_object_key is not null and nullif(new.transcript,'') is null then
  insert into public.crm_recording_jobs(recording_sid,due_at) values(new.recording_sid,now()+interval '2 minutes') on conflict do nothing;
 elsif nullif(new.transcript,'') is not null then
  update public.crm_recording_jobs set state='completed',lease_token=null,lease_until=null,last_error=null,updated_at=now() where recording_sid=new.recording_sid;
 end if;
 return new;
end $$;
drop trigger if exists crm_recording_queue on public.call_recordings;
create trigger crm_recording_queue after insert or update of cloudflare_object_key,lead_id,transcript on public.call_recordings for each row execute function public.crm_recording_queue();
create or replace function public.crm_recording_mapping_repair() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.call_recordings set lead_id=new.lead_id,call_log_id=new.call_log_id where twilio_call_sid=new.call_sid and lead_id is null;
 return new;
end $$;
drop trigger if exists crm_recording_mapping_repair on public.crm_call_sids;
create trigger crm_recording_mapping_repair after insert or update on public.crm_call_sids for each row execute function public.crm_recording_mapping_repair();
create or replace function public.claim_crm_recording_jobs(p_limit integer,p_sid text default null) returns setof public.crm_recording_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.crm_recording_jobs set state='failed',last_error='Processing stopped during the final attempt. Review and retry explicitly.',lease_token=null,lease_until=null,updated_at=now()
 where state='processing' and lease_until<now() and attempts>=5;
 update public.call_recordings r set transcription_status='failed',transcription_error=j.last_error from public.crm_recording_jobs j
 where r.recording_sid=j.recording_sid and j.state='failed' and nullif(r.transcript,'') is null and r.transcription_status is distinct from 'failed';
 return query update public.crm_recording_jobs set state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 where recording_sid in (select recording_sid from public.crm_recording_jobs where (p_sid is null or recording_sid=p_sid) and attempts<5 and ((state in ('pending','retry') and due_at<=now()) or (state='processing' and lease_until<now())) order by due_at limit least(greatest(p_limit,1),2) for update skip locked) returning *;
end $$;

-- Existing history is reconciled quietly; only explicit repairs enqueue historical work.
select set_config('crm.quiet_backfill','on',true);
update public.call_recordings r set lead_id=m.lead_id,call_log_id=coalesce(r.call_log_id,m.call_log_id)
from public.crm_call_sids m where r.twilio_call_sid=m.call_sid and r.lead_id is null;
update public.call_recordings set transcription_status=case when nullif(transcript,'') is null then 'pending' else 'completed' end where transcription_status is null;
with latest as (
 select distinct on (message_key) message_key,status,occurred_at,payload from public.crm_sms_provider_events
 order by message_key,public.crm_sms_status_rank(status) desc,occurred_at desc,event_id desc
)
update public.sms_messages m set delivery_status=e.status,delivery_updated_at=e.occurred_at,
 delivery_error=nullif(concat_ws(' — ',e.payload#>>'{errors,0,code}',e.payload#>>'{errors,0,detail}'),'')
from latest e where m.twilio_sid=e.message_key;
select set_config('crm.quiet_backfill','off',true);

revoke all on function public.project_crm_sms_delivery(text),public.apply_crm_conversation_signal(text,text,timestamptz,jsonb),public.complete_crm_callback(text,timestamptz,text,boolean),public.claim_crm_recording_jobs(integer,text) from public,anon,authenticated;
grant execute on function public.project_crm_sms_delivery(text),public.apply_crm_conversation_signal(text,text,timestamptz,jsonb),public.complete_crm_callback(text,timestamptz,text,boolean),public.claim_crm_recording_jobs(integer,text) to service_role;
revoke all on function public.crm_sms_delivery_event_trigger(),public.crm_sms_delivery_message_trigger(),public.crm_website_intake_alert(),public.crm_recording_link(),public.crm_recording_queue(),public.crm_recording_mapping_repair() from public,anon,authenticated;

-- Serialize primary quote creation; concurrent rep actions must reuse one quote.
create or replace function public.ensure_crm_primary_quote(p_lead text,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; q jsonb; ids jsonb; fresh boolean:=false;
begin
 select data into d from public.crm_leads where id=p_lead and not deleted for update;
 if d is null then raise exception 'Lead not found';end if;
 if nullif(d->>'quoteId','') is not null then
  select data into q from public.crm_quotes where id=d->>'quoteId' and not deleted;
  if q is null then raise exception 'The linked quote is missing; resolve its link first';end if;
  return jsonb_build_object('lead',d,'quote',q,'created',false);
 end if;
 select data into q from public.crm_quotes where data->>'leadId'=p_lead and not deleted order by data->>'createdAt' desc,id desc limit 1;
 if q is null then
  if p_quote->>'leadId' is distinct from p_lead or nullif(p_quote->>'id','') is null or p_quote->>'status'<>'draft' then raise exception 'Valid draft quote required';end if;
  q:=p_quote||jsonb_build_object('revision',1);
  insert into public.crm_quotes(id,data,deleted,updated_at) values(q->>'id',q,false,clock_timestamp());fresh:=true;
 end if;
 select coalesce(jsonb_agg(distinct value),'[]') into ids from jsonb_array_elements(coalesce(d->'quoteIds','[]')||jsonb_build_array(q->>'id'));
 d:=d||jsonb_build_object('quoteId',q->>'id','quoteIds',ids);
 if fresh and coalesce(d->>'stage','new') in ('new','contacted','qualified','pricing') then d:=d||jsonb_build_object('stage','pricing');end if;
 update public.crm_leads set data=d,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where id=p_lead;
 return jsonb_build_object('lead',d,'quote',q,'created',fresh);
end $$;
revoke all on function public.ensure_crm_primary_quote(text,jsonb) from public,anon,authenticated;
grant execute on function public.ensure_crm_primary_quote(text,jsonb) to service_role;
