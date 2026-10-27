-- Durable transport evidence and shared-domain controls. No messages are queued by this migration.
create table if not exists public.email_sender_accounts (
 id uuid primary key default gen_random_uuid(), provider text not null, domain text not null, from_email text not null,
 from_name text not null default 'Saturn Star Movers', reply_to_email text, region text, status text not null default 'setup',
 daily_cap integer not null default 25, ramp_day integer not null default 0, health_score numeric, warmup_provider text,
 warmup_started_at timestamptz, campaign_ready_at timestamptz, last_health_checked_at timestamptz,
 last_bounce_rate numeric, last_complaint_rate numeric, last_reply_rate numeric, pause_reason text, last_error text,
 metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(provider,from_email)
);
create table public.crm_email_domains (
 domain text primary key check(domain=lower(domain)), purpose text not null check(purpose in ('outreach','transactional')),
 status text not null default 'setup' check(status in ('setup','warming','active','paused')),
 daily_cap integer not null default 50 check(daily_cap between 0 and 49000),
 minimum_interval_seconds integer not null default 120 check(minimum_interval_seconds between 1 and 86400),
 next_send_at timestamptz, health jsonb not null default '{}', checked_at timestamptz,
 postal_address text, pause_reason text, updated_at timestamptz not null default now()
);
create table public.crm_email_provider_health (
 region text primary key, snapshot jsonb not null, checked_at timestamptz not null
);
create table public.crm_email_requests (
 id uuid primary key default gen_random_uuid(), request_key text not null unique, fingerprint text not null,
 purpose text not null check(purpose in ('outreach','transactional','internal')),
 from_address text not null, domain text not null, recipients jsonb not null, subject text not null,
 context jsonb not null default '{}', unsubscribe_hash text, created_at timestamptz not null default now()
);
create unique index crm_email_unsubscribe_token on public.crm_email_requests(unsubscribe_hash) where unsubscribe_hash is not null;
create table public.crm_email_attempts (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.crm_email_requests(id),
 attempt_number integer not null, state text not null default 'prepared' check(state in ('prepared','dispatching','accepted','rejected','unknown')),
 provider_message_id text, error_code text, transport_fingerprint text, created_at timestamptz not null default now(), dispatched_at timestamptz, finished_at timestamptz,
 unique(request_id,attempt_number)
);
create unique index crm_email_attempt_provider on public.crm_email_attempts(provider_message_id) where provider_message_id is not null;
create index crm_email_attempt_window on public.crm_email_attempts(created_at,request_id);
create table public.crm_email_receipts (
 event_key text primary key, provider_message_id text not null, recipient text not null,
 event_type text not null, sent_at timestamptz not null, occurred_at timestamptz not null,
 from_address text, domain text, subject text, attempt_id uuid references public.crm_email_attempts(id),
 diagnostic jsonb not null default '{}', created_at timestamptz not null default now()
);
create index crm_email_receipt_window on public.crm_email_receipts(sent_at,domain);
create index crm_email_receipt_message on public.crm_email_receipts(provider_message_id,recipient,event_type);
create table public.crm_email_suppressions (
 recipient text primary key check(recipient=lower(recipient)), reason text not null, source_event text not null,
 created_at timestamptz not null default now()
);

create table public.crm_email_preference_events (event_key text primary key,recipient text not null,request_id uuid not null references crm_email_requests(id),action text not null,occurred_at timestamptz not null default now());

create function public.crm_email_immutable() returns trigger language plpgsql as $$
begin raise exception 'Email source evidence is immutable'; end $$;
create trigger crm_email_preference_immutable before update or delete on public.crm_email_preference_events for each row execute function public.crm_email_immutable();
create trigger crm_email_request_immutable before update or delete on public.crm_email_requests for each row execute function public.crm_email_immutable();
create trigger crm_email_receipt_immutable before update or delete on public.crm_email_receipts for each row execute function public.crm_email_immutable();

create function public.reserve_crm_email(p_key text,p_fingerprint text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r crm_email_requests; a crm_email_attempts; s email_sender_accounts; d crm_email_domains; h crm_email_provider_health;
 v_recipient text; used bigint; sender_used bigint; observed bigint; quota_used bigint; recipient_count integer;
begin
 if length(p_key) not between 1 and 240 or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid email reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-email:'||p_key,0));
 select * into r from crm_email_requests where request_key=p_key;
 if found then
  if r.fingerprint<>p_fingerprint then raise exception 'Email key already belongs to different content'; end if;
  select * into a from crm_email_attempts where request_id=r.id order by attempt_number desc limit 1;
  if a.state='accepted' then return jsonb_build_object('allowed',false,'accepted',true,'messageId',a.provider_message_id,'attemptId',a.id); end if;
  if a.state in ('dispatching','unknown') then return jsonb_build_object('allowed',false,'reason','outcome_unknown','attemptId',a.id); end if;
  if a.state='prepared' then return jsonb_build_object('allowed',true,'attemptId',a.id); end if;
 end if;
 recipient_count=jsonb_array_length(p_payload->'recipients');
 if recipient_count not between 1 and 50 then raise exception 'Invalid recipient count'; end if;
 if p_payload->>'purpose'='outreach' then
  if recipient_count<>1 then raise exception 'Outreach requires one recipient per message'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crm-email-domain:'||(p_payload->>'domain'),0));
  select * into s from email_sender_accounts where provider='ses' and lower(from_email)=p_payload->>'from';
  select * into d from crm_email_domains where domain=p_payload->>'domain' for update;
  if s.id is null or d.domain is null or lower(s.domain)<>d.domain or d.purpose<>'outreach' or s.status not in ('warming','active') or d.status not in ('warming','active') then raise exception 'Outreach sender is not enabled'; end if;
  if coalesce(s.metadata->>'owner_name','')='' or s.reply_to_email is null or lower(s.reply_to_email)<>p_payload->>'replyTo' then raise exception 'Outreach owner or reply route is missing'; end if;
  if d.checked_at is null or d.checked_at<now()-interval '1 hour' or coalesce(d.health->>'ready','false')<>'true' then raise exception 'Sender health must be verified before outreach'; end if;
  if coalesce(d.postal_address,'')='' then raise exception 'Outreach postal address has not been recorded'; end if;
  if d.next_send_at>now() then raise exception 'Domain sending interval has not elapsed'; end if;
  v_recipient=lower(p_payload->'recipients'->>0);
  if exists(select 1 from crm_email_suppressions where crm_email_suppressions.recipient=v_recipient) or
     exists(select 1 from market_contacts c where lower(c.email)=v_recipient and (c.do_not_contact or c.cross_channel_suppressed_at is not null or c.email_unsubscribed_at is not null or c.email_status in ('bounced','complained','unsubscribed'))) then raise exception 'Recipient is suppressed'; end if;
  select coalesce(sum(jsonb_array_length(q.recipients)),0) into used from crm_email_attempts x join crm_email_requests q on q.id=x.request_id where q.domain=d.domain and x.created_at>now()-interval '24 hours' and x.state<>'rejected';
  select count(*) into observed from (select distinct provider_message_id,crm_email_receipts.recipient from crm_email_receipts where domain=d.domain and sent_at>now()-interval '24 hours' and event_type='email_provider_accepted' and attempt_id is null) x;
  select coalesce(sum(jsonb_array_length(q.recipients)),0) into sender_used from crm_email_attempts x join crm_email_requests q on q.id=x.request_id where q.from_address=lower(s.from_email) and x.created_at>now()-interval '24 hours' and x.state<>'rejected';
  if used+observed+recipient_count>d.daily_cap or sender_used+recipient_count>s.daily_cap then raise exception 'Rolling sender or shared domain limit reached'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crm-email-account:'||coalesce(s.region,'us-east-2'),0));
  select * into h from crm_email_provider_health where region=coalesce(s.region,'us-east-2');
  if h.region is null or h.checked_at<now()-interval '15 minutes' or coalesce(h.snapshot->>'sendingEnabled','false')<>'true' or coalesce(h.snapshot->>'production','false')<>'true' or coalesce(h.snapshot->>'enforcement','unknown')<>'HEALTHY' then raise exception 'SES account health must be refreshed'; end if;
  -- Leave room for customer quotes/receipts/alerts. Alias creation cannot multiply the account quota.
  select coalesce(sum(jsonb_array_length(q.recipients)),0) into quota_used from crm_email_attempts x join crm_email_requests q on q.id=x.request_id where x.created_at>h.checked_at and x.state<>'rejected';
  if coalesce((h.snapshot->>'sentLast24Hours')::bigint,0)+quota_used+recipient_count>greatest(coalesce((h.snapshot->>'max24HourSend')::bigint,0)-1000,0) then raise exception 'SES operational reserve reached'; end if;
  update crm_email_domains set next_send_at=now()+make_interval(secs=>minimum_interval_seconds),updated_at=now() where domain=d.domain;
 end if;
 if r.id is null then
  insert into crm_email_requests(request_key,fingerprint,purpose,from_address,domain,recipients,subject,context,unsubscribe_hash)
  values(p_key,p_fingerprint,p_payload->>'purpose',p_payload->>'from',p_payload->>'domain',p_payload->'recipients',p_payload->>'subject',coalesce(p_payload->'context','{}'),p_payload->>'unsubscribeHash') returning * into r;
 end if;
 insert into crm_email_attempts(request_id,attempt_number) values(r.id,coalesce(a.attempt_number,0)+1) returning * into a;
 return jsonb_build_object('allowed',true,'attemptId',a.id);
end $$;

create function public.start_crm_email(p_attempt uuid,p_content_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r crm_email_requests;
begin
 if p_content_hash !~ '^[a-f0-9]{64}$' then raise exception 'Transport fingerprint is required'; end if;
 select q.* into r from crm_email_requests q join crm_email_attempts a on a.request_id=q.id where a.id=p_attempt;
 if r.purpose='outreach' and not exists(select 1 from email_sender_accounts s join crm_email_domains d on d.domain=s.domain where lower(s.from_email)=r.from_address and s.provider='ses' and s.status in ('warming','active') and d.status in ('warming','active') and d.checked_at>now()-interval '1 hour' and d.health->>'ready'='true') then raise exception 'Sender paused before dispatch'; end if;
 if r.purpose='outreach' and exists(select 1 from market_contacts c where lower(c.email)=r.recipients->>0 and (c.do_not_contact or c.cross_channel_suppressed_at is not null or c.email_unsubscribed_at is not null or c.email_status in ('bounced','complained','unsubscribed'))) then raise exception 'Recipient opted out before dispatch'; end if;
 if r.purpose='outreach' and exists(select 1 from crm_email_suppressions where recipient=r.recipients->>0) then raise exception 'Recipient opted out before dispatch'; end if;
 update crm_email_attempts set state='dispatching',dispatched_at=now(),transport_fingerprint=p_content_hash where id=p_attempt and state='prepared';
 return found;
end $$;
create function public.finish_crm_email(p_attempt uuid,p_state text,p_message text default null,p_error text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_state not in ('accepted','rejected','unknown') or (p_state='accepted' and coalesce(p_message,'')='') then raise exception 'Invalid transport result'; end if;
 update crm_email_attempts set state=p_state,provider_message_id=p_message,error_code=left(p_error,120),finished_at=now() where id=p_attempt and state='dispatching';
 if not found and not exists(select 1 from crm_email_attempts where id=p_attempt and state='accepted' and provider_message_id=p_message) then raise exception 'Email attempt is not dispatching'; end if;
end $$;

create function public.record_crm_email_receipt(p_event jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; reason text;
begin
 if coalesce(p_event->>'messageId','')='' or coalesce(p_event->>'recipient','')='' then raise exception 'Receipt identity is required'; end if;
 if coalesce(p_event->>'attemptId','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  select a.id into target from crm_email_attempts a join crm_email_requests q on q.id=a.request_id
  where a.id=(p_event->>'attemptId')::uuid and q.recipients ? lower(p_event->>'recipient') and q.from_address=lower(p_event->>'from') and q.subject=p_event->>'subject' and (a.provider_message_id is null or a.provider_message_id=p_event->>'messageId');
 end if;
 insert into crm_email_receipts(event_key,provider_message_id,recipient,event_type,sent_at,occurred_at,from_address,domain,subject,attempt_id,diagnostic)
 values(p_event->>'eventKey',p_event->>'messageId',lower(p_event->>'recipient'),p_event->>'eventType',(p_event->>'sentAt')::timestamptz,(p_event->>'occurredAt')::timestamptz,lower(p_event->>'from'),p_event->>'domain',p_event->>'subject',target,coalesce(p_event->'diagnostic','{}')) on conflict do nothing;
 if not found then return; end if;
 if target is not null then
  update crm_email_attempts set state='accepted',provider_message_id=p_event->>'messageId',finished_at=coalesce(finished_at,now()),error_code=null where id=target and state in ('prepared','dispatching','unknown');
 end if;
 reason=case when p_event->>'eventType'='email_complained' then 'complaint' when p_event->>'eventType'='email_unsubscribed' then 'unsubscribe' when p_event->>'eventType'='email_bounced' then 'bounce' end;
 if reason='complaint' then
  update crm_email_domains set status='paused',pause_reason='Provider complaint received. Review the message and recipient before resuming.',updated_at=now() where domain=p_event->>'domain' and purpose='outreach';
  update email_sender_accounts set status='paused',pause_reason='Shared outreach domain paused after a complaint',updated_at=now() where provider='ses' and domain in(select domain from crm_email_domains where domain=p_event->>'domain' and purpose='outreach');
 end if;
 if reason is not null then
  insert into crm_email_suppressions(recipient,reason,source_event) values(lower(p_event->>'recipient'),reason,p_event->>'eventKey') on conflict do nothing;
  update market_contacts set email_status=case when reason='bounce' then 'bounced' when reason='complaint' then 'complained' else 'unsubscribed' end,sequence_paused=true,sequence_paused_reason=p_event->>'eventType',email_unsubscribed_at=case when reason in ('complaint','unsubscribe') then coalesce(email_unsubscribed_at,now()) else email_unsubscribed_at end where lower(email)=lower(p_event->>'recipient');
  update sequence_jobs set status='cancelled',error='Paused after email provider feedback' where status='pending' and contact_id in(select id from market_contacts where lower(email)=lower(p_event->>'recipient'));
 end if;
end $$;
create function public.unsubscribe_crm_email(p_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare r crm_email_requests; recipient text;
begin
 select * into r from crm_email_requests where unsubscribe_hash=p_hash and purpose='outreach';
 if not found then return false; end if;
 for recipient in select jsonb_array_elements_text(r.recipients) loop
  insert into crm_email_preference_events(event_key,recipient,request_id,action) values('unsubscribe:'||r.id||':'||recipient,recipient,r.id,'unsubscribe') on conflict do nothing;
  insert into crm_email_suppressions(recipient,reason,source_event) values(recipient,'unsubscribe','unsubscribe:'||r.id) on conflict do nothing;
  update market_contacts set email_unsubscribed_at=coalesce(email_unsubscribed_at,now()),email_status='unsubscribed',sequence_paused=true,sequence_paused_reason='email_unsubscribed' where lower(email)=recipient;
  update sequence_jobs set status='cancelled',error='Paused after email unsubscribe' where status='pending' and contact_id in(select id from market_contacts where lower(email)=recipient);
 end loop;
 return true;
end $$;

-- The example alias is a draft for the existing owner, not an invented employee or a new mailbox.
insert into crm_email_domains(domain,purpose) values('saturnstarmovers.ca','outreach'),('starmovers.ca','transactional');
update crm_email_domains set postal_address='3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4, Canada' where domain='saturnstarmovers.ca';
insert into email_sender_accounts(provider,domain,from_email,from_name,reply_to_email,region,status,daily_cap,metadata)
values('ses','saturnstarmovers.ca','john@saturnstarmovers.ca','John | Saturn Star Movers','business@starmovers.ca','us-east-2','setup',25,'{"owner_name":"John","purpose":"outreach","origin":"existing_sender"}'),
('ses','saturnstarmovers.ca','jo@saturnstarmovers.ca','John | Saturn Star Movers','business@starmovers.ca','us-east-2','setup',25,'{"owner_name":"John","purpose":"outreach","origin":"owner_example_alias","mailbox_created":false}') on conflict(provider,from_email) do nothing;

do $$ declare t text; begin
 foreach t in array array['email_sender_accounts','crm_email_domains','crm_email_provider_health','crm_email_requests','crm_email_attempts','crm_email_receipts','crm_email_suppressions','crm_email_preference_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
grant insert,update on email_sender_accounts,crm_email_domains,crm_email_provider_health to service_role;
revoke all on function reserve_crm_email(text,text,jsonb),start_crm_email(uuid,text),finish_crm_email(uuid,text,text,text),record_crm_email_receipt(jsonb),unsubscribe_crm_email(text) from public,anon,authenticated;
grant execute on function reserve_crm_email(text,text,jsonb),start_crm_email(uuid,text),finish_crm_email(uuid,text,text,text),record_crm_email_receipt(jsonb),unsubscribe_crm_email(text) to service_role;

create function public.crm_email_foundation_report() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'domains',(select coalesce(jsonb_agg(to_jsonb(d) order by domain),'[]') from crm_email_domains d),
 'senders',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'email',s.from_email,'name',s.from_name,'replyTo',s.reply_to_email,'domain',s.domain,'status',s.status,'dailyCap',s.daily_cap,'owner',s.metadata->>'owner_name') order by s.from_email),'[]') from email_sender_accounts s where provider='ses'),
 'provider',(select jsonb_build_object('region',region,'snapshot',snapshot,'checkedAt',checked_at) from crm_email_provider_health order by checked_at desc limit 1),
 'counts',jsonb_build_object(
   'recordedRecipientSends',(select count(*) from (select distinct provider_message_id,recipient from crm_email_receipts where sent_at>now()-interval '24 hours') x),
   'applicationAttempts',(select count(*) from crm_email_attempts where created_at>now()-interval '24 hours'),
   'unresolvedAttempts',(select count(*) from crm_email_attempts where state='unknown' or (state in ('prepared','dispatching') and created_at<now()-interval '5 minutes'))),
 'recentReceipts',(select coalesce(jsonb_agg(to_jsonb(x) order by sent_at desc),'[]') from (select * from (select distinct on(provider_message_id,recipient) provider_message_id,recipient,subject,from_address,sent_at,event_type from crm_email_receipts order by provider_message_id,recipient,case when event_type in ('email_bounced','email_complained','email_rejected','email_unsubscribed') then 0 when event_type='email_delivered' then 1 else 2 end,occurred_at desc) r order by sent_at desc limit 50) x),
 'pending',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at),'[]') from (select a.id,a.state,a.provider_message_id,a.error_code,a.created_at,q.from_address,q.recipients,q.subject,q.purpose from crm_email_attempts a join crm_email_requests q on q.id=a.request_id where a.state='unknown' or (a.state in ('prepared','dispatching') and a.created_at<now()-interval '5 minutes') order by a.created_at limit 50) x),
 'recentAttempts',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]') from (select a.id,a.state,a.provider_message_id,a.error_code,a.created_at,q.from_address,q.recipients,q.subject,q.purpose,q.context from crm_email_attempts a join crm_email_requests q on q.id=a.request_id order by a.created_at desc limit 50) x)
 )
$$;
revoke all on function crm_email_foundation_report() from public,anon,authenticated;
grant execute on function crm_email_foundation_report() to service_role;
