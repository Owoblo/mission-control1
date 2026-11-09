-- Staged Google fleet. Existing OAuth campaign_enabled=false constraint remains:
-- activation requires a separately reviewed rollout migration after live tests.
create table public.google_mail_fleet_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 inbox_cap integer not null default 10 check(inbox_cap between 1 and 30),
 domain_cap integer not null default 20 check(domain_cap between 1 and 60)
);
insert into public.google_mail_fleet_settings(singleton) values(true);
create table public.google_mail_health (
 email text primary key references public.google_mail_connections(email),
 ready boolean not null default false, checked_at timestamptz,
 sync_checked_at timestamptz, reasons jsonb not null default '[]', snapshot jsonb not null default '{}'
);
create table public.google_mail_assignments (
 contact_id uuid primary key references public.market_contacts(id),
 email text not null references public.google_mail_connections(email), recipient text not null,
 thread_id text, last_message_id text, subject text, paused boolean not null default false,
 pause_reason text, created_at timestamptz not null default now()
);
create table public.google_mail_jobs (
 id uuid primary key default gen_random_uuid(), action_key text not null unique,
 contact_id uuid not null references public.market_contacts(id), payload jsonb not null,
 scheduled_at timestamptz not null default now(), state text not null default 'pending'
 check(state in ('pending','held','dispatching','accepted','rejected','unknown','cancelled')),
 claimed_at timestamptz, accepted_at timestamptz, message_id text, thread_id text, error text,
 check(state<>'accepted' or (message_id is not null and thread_id is not null and accepted_at is not null))
);
create index google_mail_jobs_due on public.google_mail_jobs(scheduled_at) where state='pending';
create table public.google_mail_inbound (
 email text not null, message_id text not null, contact_id uuid not null references public.market_contacts(id),
 thread_id text not null, occurred_at timestamptz not null, kind text not null,
 primary key(email,message_id)
);
-- RLS + no browser grants. Reviews and queue admission are service-only.
do $$ declare t text; begin
 foreach t in array array['google_mail_fleet_settings','google_mail_health','google_mail_assignments','google_mail_jobs','google_mail_inbound'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.claim_google_mail_job(p_id uuid,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j google_mail_jobs%rowtype; a google_mail_assignments%rowtype; c market_contacts%rowtype;
 f google_mail_fleet_settings%rowtype; sender text; domain text; review jsonb; policy jsonb;
begin
 -- Small fleet: one lock makes cross-inbox domain budgets and assignments atomic.
 perform pg_advisory_xact_lock(hashtextextended('google-mail-dispatch',0));
 select * into j from google_mail_jobs where id=p_id for update;
 if not found then raise exception 'Missing Google job'; end if;
 if j.state<>'pending' then return jsonb_build_object('claimed',false,'state',j.state); end if;
 select * into f from google_mail_fleet_settings where singleton;
 if not coalesce(f.enabled,false) then raise exception 'Google fleet disabled'; end if;
 if j.scheduled_at>now() then raise exception 'Google job not due'; end if;
 sender:=j.payload->>'replyTo';domain:=split_part(sender,'@',2);
 if not exists(select 1 from google_mail_connections where email=sender and status='connected' and campaign_enabled) then raise exception 'Google mailbox disabled'; end if;
 if not exists(select 1 from google_mail_health where email=sender and ready and checked_at between now()-interval '1 hour' and now() and sync_checked_at between now()-interval '5 minutes' and now()) then raise exception 'Google health or reply sync stale'; end if;
 select * into c from market_contacts where id=j.contact_id for update;
 if not found or lower(c.email) is distinct from j.payload->>'recipient' or coalesce(c.do_not_contact,false) or c.cross_channel_suppressed_at is not null or c.email_unsubscribed_at is not null or c.email_status in ('bounced','complained','unsubscribed') or coalesce(c.sequence_paused,false) then raise exception 'Google contact suppressed or changed'; end if;
 select record into review from prepared_email_reviews where id=j.payload->>'reviewId';
 if review is null or review->>'status' is distinct from 'approved' or review->>'contentHash' is distinct from j.payload->>'contentHash' or review->>'contactId' is distinct from j.contact_id::text or not coalesce((review->>'expiresAt')::timestamptz>now(),false) then raise exception 'Google review missing or expired'; end if;
 if p_evidence->>'sender' is distinct from j.payload->>'sender' or p_evidence->>'recipient' is distinct from c.email or p_evidence->>'contentHash' is distinct from encode(sha256(convert_to((j.payload->>'subject')||E'\n'||(j.payload->>'text'),'UTF8')),'hex') then raise exception 'Google policy evidence binding mismatch'; end if;
 select * into a from google_mail_assignments where contact_id=j.contact_id for update;
 if found and (a.email<>sender or a.recipient<>c.email or a.paused) then raise exception 'Google original sender locked or conversation paused'; end if;
 if a.contact_id is not null and (a.thread_id is null or a.last_message_id is null or a.subject is distinct from j.payload->>'subject') then raise exception 'Google conversation requires reconciliation'; end if;
 if exists(select 1 from google_mail_jobs where contact_id=j.contact_id and state in ('dispatching','unknown')) then raise exception 'Google send outcome unresolved'; end if;
 if (select count(*) from google_mail_jobs where payload->>'replyTo'=sender and claimed_at>now()-interval '24 hours')>=f.inbox_cap then raise exception 'Google inbox capacity reached'; end if;
 if (select count(*) from google_mail_jobs where split_part(payload->>'replyTo','@',2)=domain and claimed_at>now()-interval '24 hours')>=f.domain_cap then raise exception 'Google domain capacity reached'; end if;
 if exists(select 1 from google_mail_jobs where payload->>'replyTo'=sender and claimed_at>now()-interval '10 minutes') then raise exception 'Google pacing hold'; end if;
 -- Reservation and capacity claim commit together. A later hold rolls both back.
 policy:=public.reserve_partnership_action(j.contact_id,'email','cold_introduction','google-mail:'||j.id::text,p_evidence);
 if policy->>'allowed' is distinct from 'true' then raise exception 'Google relationship policy held: %',policy->'reasons'; end if;
 insert into google_mail_assignments(contact_id,email,recipient,subject) values(j.contact_id,sender,c.email,j.payload->>'subject') on conflict do nothing;
 update google_mail_jobs set state='dispatching',claimed_at=now(),error=null where id=j.id;
 return jsonb_build_object('claimed',true,'threadId',a.thread_id,'inReplyTo',a.last_message_id);
end $$;
create function public.finish_google_mail_job(p_id uuid,p_state text,p_message text,p_thread text,p_rfc_id text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare j google_mail_jobs%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('google-mail-dispatch',0));
 select * into j from google_mail_jobs where id=p_id for update;
 if j.state is distinct from 'dispatching' or p_state not in ('accepted','unknown','rejected') then raise exception 'Google transition invalid'; end if;
 if p_state='accepted' and (nullif(p_message,'') is null or nullif(p_thread,'') is null or nullif(p_rfc_id,'') is null) then raise exception 'Google receipt incomplete'; end if;
 update google_mail_jobs set state=p_state,message_id=p_message,thread_id=p_thread,accepted_at=case when p_state='accepted' then now() end where id=p_id;
 if p_state='accepted' then update google_mail_assignments set thread_id=p_thread,last_message_id=p_rfc_id where contact_id=j.contact_id; end if;
end $$;
create function public.record_google_mail_inbound(p_email text,p_message text,p_contact uuid,p_thread text,p_occurred timestamptz,p_kind text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare inserted integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('google-mail-dispatch',0));
 if not exists(select 1 from google_mail_assignments where contact_id=p_contact and email=p_email and thread_id=p_thread) then raise exception 'Google inbound binding mismatch'; end if;
 insert into google_mail_inbound values(p_email,p_message,p_contact,p_thread,p_occurred,p_kind) on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 then
  insert into market_touches(contact_id,channel,direction,notes,created_by,created_at,metadata)
  values(p_contact,'email','inbound','Google email response received. Review the original mailbox thread before replying.','Google mail sync',p_occurred,jsonb_build_object('provider','google','mailbox',p_email,'provider_message_id',p_message,'thread_id',p_thread,'classification',p_kind,'human_reply',false));
 end if;
 update google_mail_assignments set paused=true,pause_reason='inbound_'||p_kind where contact_id=p_contact;
 update google_mail_jobs set state='cancelled',error='Inbound response requires review' where contact_id=p_contact and state='pending';
 update market_contacts set last_inbound_at=greatest(last_inbound_at,p_occurred),sequence_paused=true,sequence_paused_reason='google_email_inbound' where id=p_contact;
 update sequence_jobs set status='cancelled',error='Google email response requires review' where contact_id=p_contact and status='pending';
 return inserted=1;
end $$;
revoke all on function public.claim_google_mail_job(uuid,jsonb),public.finish_google_mail_job(uuid,text,text,text,text),public.record_google_mail_inbound(text,text,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.claim_google_mail_job(uuid,jsonb),public.finish_google_mail_job(uuid,text,text,text,text),public.record_google_mail_inbound(text,text,uuid,text,timestamptz,text) to service_role;

-- Exact reviewed content and sender assignments cannot be edited underneath a worker.
create function public.guard_google_mail_identity() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception 'Google mail history cannot be deleted'; end if;
 if tg_table_name='google_mail_jobs' then
  if new.id<>old.id or new.action_key<>old.action_key or new.contact_id<>old.contact_id or new.payload<>old.payload then raise exception 'Google reviewed job identity is immutable'; end if;
 end if;
 if tg_table_name='google_mail_assignments' then
  if new.contact_id<>old.contact_id or new.email<>old.email or new.recipient<>old.recipient then raise exception 'Google sender assignment is immutable'; end if;
 end if;
 return new;
end $$;
create trigger google_job_identity before update or delete on public.google_mail_jobs for each row execute function public.guard_google_mail_identity();
create trigger google_assignment_identity before update or delete on public.google_mail_assignments for each row execute function public.guard_google_mail_identity();
