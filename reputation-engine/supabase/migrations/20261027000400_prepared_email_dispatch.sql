-- Approved exact-copy email records. No browser role can approve or dispatch.
alter table public.sequence_jobs add column if not exists email_payload jsonb;
alter table public.sequence_jobs add column if not exists execution_key text;
create unique index if not exists sequence_jobs_execution_key on public.sequence_jobs(execution_key) where execution_key is not null;

create table if not exists public.prepared_email_reviews (
  id text primary key,
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  created_at timestamptz not null default now()
);
create table if not exists public.prepared_email_evidence (
  id text primary key,
  record jsonb not null check (jsonb_typeof(record) = 'object' and record->>'id' = id),
  created_at timestamptz not null default now()
);
create table if not exists public.prepared_email_dispatches (
  action_key text primary key,
  job_id uuid not null unique references public.sequence_jobs(id),
  contact_id uuid not null references public.market_contacts(id),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('dispatching','held','ambiguous','accepted')),
  provider text,
  message_id text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (state <> 'accepted' or (provider is not null and nullif(message_id,'') is not null and accepted_at is not null))
);
alter table public.prepared_email_reviews enable row level security;
alter table public.prepared_email_evidence enable row level security;
alter table public.prepared_email_dispatches enable row level security;
revoke all on public.prepared_email_reviews, public.prepared_email_evidence, public.prepared_email_dispatches from public, anon, authenticated;
grant all on public.prepared_email_reviews, public.prepared_email_evidence, public.prepared_email_dispatches to service_role;

-- No lease expiry: after a crash or timeout a human/provider reconciliation is
-- required. SES has no send idempotency key; retrying could duplicate the email.
create or replace function public.claim_prepared_email_dispatch(p_action_key text,p_job_id uuid,p_contact_id uuid,p_content_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.prepared_email_dispatches%rowtype; inserted integer;
begin
 if nullif(trim(p_action_key),'') is null or p_content_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid prepared email claim'; end if;
 if not exists(select 1 from public.sequence_jobs where id=p_job_id and contact_id=p_contact_id and channel='email' and template_key='prepared_email_v1' and email_payload->>'actionKey'=p_action_key and email_payload->>'contentHash'=p_content_hash) then raise exception 'Prepared queue binding mismatch'; end if;
 insert into public.prepared_email_dispatches(action_key,job_id,contact_id,content_hash,state)
 values(p_action_key,p_job_id,p_contact_id,p_content_hash,'dispatching') on conflict do nothing;
 get diagnostics inserted = row_count;
 select * into existing from public.prepared_email_dispatches where action_key=p_action_key;
 if not found or existing.job_id<>p_job_id or existing.contact_id<>p_contact_id or existing.content_hash<>p_content_hash then raise exception 'Prepared dispatch identity conflict'; end if;
 return jsonb_build_object('claimed',inserted=1,'dispatch',to_jsonb(existing));
end $$;
revoke all on function public.claim_prepared_email_dispatch(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_prepared_email_dispatch(text,uuid,uuid,text) to service_role;

-- Admission never approves evidence or sends. The worker repeats the full
-- contract and live policy checks at execution time.
create or replace function public.enqueue_prepared_email(p_payload jsonb,p_scheduled_at timestamptz,p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.market_contacts%rowtype; j public.sequence_jobs%rowtype; review jsonb; ref jsonb; evidence jsonb; jid uuid; execution text;
begin
 if jsonb_typeof(p_payload)<>'object' or p_payload->>'version'<>'ssm-prepared-email/1' or coalesce(p_payload->>'contentHash','') !~ '^[a-f0-9]{64}$' or nullif(trim(p_payload->>'actionKey'),'') is null or p_scheduled_at is null or p_scheduled_at<now()-interval '1 minute' then raise exception 'Invalid prepared email payload or schedule'; end if;
 execution:='prepared-email:'||(p_payload->>'actionKey');
 perform pg_advisory_xact_lock(hashtextextended('prepared-email-enqueue',0));
 select * into j from public.sequence_jobs where execution_key=execution;
 if found then
   if j.email_payload is distinct from p_payload then raise exception 'Prepared email idempotency content conflict'; end if;
   return jsonb_build_object('id',j.id,'status',j.status,'replay',true);
 end if;
 select * into c from public.market_contacts where id=(p_payload->>'contactId')::uuid for update;
 if not found or c.email is distinct from p_payload->>'recipient' or c.city is distinct from p_payload->>'city' or c.partner_company_id::text is distinct from p_payload->>'accountId' then raise exception 'Prepared email recipient binding mismatch'; end if;
 if coalesce(c.do_not_contact,false) or coalesce(c.sequence_paused,false) or c.stage in ('dnc','do_not_contact','closed_lost') or to_jsonb(c)->>'cross_channel_suppressed_at' is not null or to_jsonb(c)->>'email_unsubscribed_at' is not null or to_jsonb(c)->>'email_status' in ('bounced','complained','unsubscribed') then raise exception 'Prepared email recipient suppressed'; end if;
 if exists(select 1 from public.sequence_jobs where contact_id=c.id and channel='email' and status in ('pending','running','sent')) then raise exception 'Prepared email recipient already queued or sent'; end if;
 select record into review from public.prepared_email_reviews where id=p_payload->>'reviewId';
 if review is null or review->>'eventType' is distinct from 'prepared_email.reviewed' or review->>'status' is distinct from 'approved' or nullif(trim(review->>'reviewedBy'),'') is null or review->'holds' is distinct from '[]'::jsonb then raise exception 'Approved prepared email review required'; end if;
 if (review->>'expiresAt')::timestamptz<=now() or (review->>'reviewedAt')::timestamptz>now() or (review->>'expiresAt')::timestamptz>(review->>'reviewedAt')::timestamptz+interval '24 hours' or review->>'expiresAt' is null or review->>'reviewedAt' is null then raise exception 'Prepared email review expired'; end if;
 if review->>'candidateId' is distinct from p_payload->>'candidateId' or review->>'contactId' is distinct from p_payload->>'contactId' or review->>'accountId' is distinct from p_payload->>'accountId' or review->>'actionKey' is distinct from p_payload->>'actionKey' or review->>'contentHash' is distinct from p_payload->>'contentHash' or review->'evidenceRefs' is distinct from p_payload->'evidenceRefs' then raise exception 'Prepared email review binding mismatch'; end if;
 if jsonb_typeof(p_payload->'evidenceRefs') is distinct from 'array' then raise exception 'Prepared email evidence required'; end if;
 if (select count(distinct value->>'kind') from jsonb_array_elements(p_payload->'evidenceRefs') where value->>'kind' in ('identity','mailbox','outreach_eligibility','shared_context','copy'))<>5 then raise exception 'Prepared email evidence incomplete'; end if;
 for ref in select value from jsonb_array_elements(p_payload->'evidenceRefs') loop
   select record into evidence from public.prepared_email_evidence where id=ref->>'id';
   if evidence is null or evidence->>'kind' is distinct from ref->>'kind' or evidence->>'sha256' is distinct from ref->>'sha256' or evidence->>'status' is distinct from 'approved' or nullif(trim(evidence->>'reviewedBy'),'') is null or evidence->'holds' is distinct from '[]'::jsonb then raise exception 'Prepared email evidence not approved'; end if;
   if evidence->>'candidateId' is distinct from p_payload->>'candidateId' or evidence->>'contactId' is distinct from p_payload->>'contactId' or evidence->>'accountId' is distinct from p_payload->>'accountId' or evidence->>'recipient' is distinct from p_payload->>'recipient' then raise exception 'Prepared email evidence binding mismatch'; end if;
   if evidence->>'validUntil' is null or evidence->>'observedAt' is null or (evidence->>'validUntil')::timestamptz<=now() or (evidence->>'observedAt')::timestamptz>now() then raise exception 'Prepared email evidence expired'; end if;
 end loop;
 insert into public.sequence_jobs(contact_id,batch_id,channel,scheduled_at,status,template_key,execution_key,email_payload)
 values(c.id,p_batch_id,'email',p_scheduled_at,'pending','prepared_email_v1',execution,p_payload) returning id into jid;
 return jsonb_build_object('id',jid,'status','pending','replay',false);
end $$;
revoke all on function public.enqueue_prepared_email(jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_prepared_email(jsonb,timestamptz,uuid) to service_role;
