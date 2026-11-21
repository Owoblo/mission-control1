-- Dedicated second-step ledger. Initial prepared-email jobs and their deduplication are unchanged.
create table if not exists public.pilot_email_followups (
 parent_job_id uuid primary key references public.sequence_jobs(id),
 contact_id uuid not null unique references public.market_contacts(id),
 action_key text not null unique,
 payload jsonb not null,
 due_at timestamptz not null,
 state text not null default 'scheduled' check(state in ('scheduled','dispatching','held','ambiguous','accepted')),
 execution_review jsonb,
 provider text, message_id text, accepted_at timestamptz, error text,
 created_at timestamptz not null default now(),
 check(payload->>'version'='pilot-day3/1'),
 check(payload->>'parentJobId'=parent_job_id::text),
 check(payload->>'contactId'=contact_id::text),
 check(payload->>'actionKey'=action_key),
 check(action_key='pilot-day3:'||parent_job_id::text),
 check(coalesce(payload->>'contentHash','') ~ '^[a-f0-9]{64}$'),
 check(state<>'accepted' or (provider='ses' and nullif(message_id,'') is not null and accepted_at is not null))
);
alter table public.pilot_email_followups enable row level security;
revoke all on public.pilot_email_followups from public,anon,authenticated;
grant all on public.pilot_email_followups to service_role;

create or replace function public.claim_pilot_day3_followup(p_parent_job_id uuid,p_content_hash text,p_review jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.pilot_email_followups%rowtype; c public.market_contacts%rowtype; j public.sequence_jobs%rowtype; d public.prepared_email_dispatches%rowtype;
begin
 select * into f from public.pilot_email_followups where parent_job_id=p_parent_job_id for update;
 if not found or f.payload->>'contentHash' is distinct from p_content_hash then raise exception 'Followup identity mismatch'; end if;
 if f.state<>'scheduled' then return jsonb_build_object('claimed',false,'state',f.state); end if;
 select * into c from public.market_contacts where id=f.contact_id for update;
 select * into j from public.sequence_jobs where id=f.parent_job_id;
 select * into d from public.prepared_email_dispatches where job_id=f.parent_job_id;
 if j.template_key is distinct from 'prepared_email_v1' or j.status is distinct from 'sent' or j.email_payload->>'version' is distinct from 'ssm-prepared-email/1' or d.state is distinct from 'accepted'
  or j.email_payload->>'contentHash' is distinct from f.payload->>'parentContentHash' or d.message_id is distinct from f.payload->>'parentProviderMessageId'
  or j.contact_id is distinct from f.contact_id or c.email is distinct from f.payload->>'recipient' or c.city is distinct from f.payload->>'city'
  or c.partner_company_id::text is distinct from f.payload->>'accountId' or j.email_payload->>'sender' is distinct from f.payload->>'sender'
  or j.email_payload->>'replyTo' is distinct from f.payload->>'replyTo' then raise exception 'Followup parent binding changed'; end if;
 if f.due_at is distinct from d.accepted_at+interval '72 hours' or f.due_at>now() then raise exception 'Followup not due'; end if;
 if coalesce(c.do_not_contact,false) or coalesce(c.sequence_paused,false) or c.stage in ('dnc','do_not_contact','closed_lost')
  or to_jsonb(c)->>'cross_channel_suppressed_at' is not null or to_jsonb(c)->>'email_unsubscribed_at' is not null
  or to_jsonb(c)->>'email_last_bounced_at' is not null or to_jsonb(c)->>'last_inbound_at' is not null or to_jsonb(c)->>'email_last_replied_at' is not null
  or to_jsonb(c)->>'email_status' in ('bounced','complained','unsubscribed') then raise exception 'Followup recipient paused/suppressed/replied'; end if;
 if exists(select 1 from public.market_touches t where t.contact_id=c.id and t.direction='inbound' and t.created_at>=d.accepted_at
  and coalesce(t.notes,'') !~* '^SES (delivered|opened|clicked|accepted) event\y') then raise exception 'Followup inbound requires review'; end if;
 if exists(select 1 from public.sequence_jobs q where q.contact_id=c.id and q.id<>j.id and q.status in ('pending','running','sent')) then raise exception 'Other outreach exists'; end if;
 if not exists(select 1 from public.email_provider_events e where e.provider_message_id=d.message_id and e.event_type='email_delivered')
  or exists(select 1 from public.email_provider_events e where e.provider_message_id=d.message_id and e.event_type in ('email_bounced','email_complained','email_rejected')) then raise exception 'Parent delivery not healthy'; end if;
 if p_review->>'complete' is distinct from 'true' or p_review->>'mailbox_complete' is distinct from 'true'
  or nullif(p_review->>'checked_at','') is null or nullif(p_review->>'mailbox_checked_at','') is null
  or (p_review->>'checked_at')::timestamptz not between now()-interval '5 minutes' and now()
  or (p_review->>'mailbox_checked_at')::timestamptz not between now()-interval '5 minutes' and now()
  or p_review->>'content_hash' is distinct from p_content_hash then raise exception 'Fresh followup review required'; end if;
 update public.pilot_email_followups set state='dispatching',execution_review=p_review where parent_job_id=f.parent_job_id;
 return jsonb_build_object('claimed',true);
end $$;
revoke all on function public.claim_pilot_day3_followup(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_pilot_day3_followup(uuid,text,jsonb) to service_role;

-- Only this reviewed, already-claimed second step may pass the existing-outreach check.
-- All other canonical reservation checks (account tasks, opt-outs, limits, health) still run.
create or replace function public.reviewed_pilot_day3_allowed(p_contact_id uuid,p_channel text,p_action_key text,p_evidence jsonb)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_channel='email' and exists(select 1 from public.pilot_email_followups f
 where f.contact_id=p_contact_id and f.action_key=p_action_key and f.state='dispatching' and f.due_at<=now()
 and f.payload->>'sender'=p_evidence->>'sender'
 and encode(sha256(convert_to(f.payload->>'text','UTF8')),'hex')=p_evidence->>'contentHash'
 and f.execution_review->>'complete'='true' and f.execution_review->>'mailbox_complete'='true'
 and (f.execution_review->>'checked_at')::timestamptz between now()-interval '5 minutes' and now()
 and (f.execution_review->>'mailbox_checked_at')::timestamptz between now()-interval '5 minutes' and now());
$$;
revoke all on function public.reviewed_pilot_day3_allowed(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reviewed_pilot_day3_allowed(uuid,text,text,jsonb) to service_role;
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:='and not public.reviewed_nonresponse_email_allowed(p_contact_id,p_channel,p_action_key,p_evidence)';
 new_predicate:='and not (public.reviewed_nonresponse_email_allowed(p_contact_id,p_channel,p_action_key,p_evidence) or public.reviewed_pilot_day3_allowed(p_contact_id,p_channel,p_action_key,p_evidence))';
 if position(new_predicate in definition)>0 then return; end if;
 if position(old_predicate in definition)=0 then raise exception 'Unexpected existing outreach policy; inspect before applying'; end if;
 execute replace(definition,old_predicate,new_predicate);
end $migration$;
