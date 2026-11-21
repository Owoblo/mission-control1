-- Cross-channel reservations. No provider credentials or permission grants to clients.
create table if not exists public.partnership_action_reservations (
 action_key text primary key,
 account_id uuid not null,
 contact_id uuid not null,
 channel text not null check(channel in ('email','sms','phone','direct_mail')),
 action_kind text not null check(action_kind in ('cold_introduction','reply','fulfil_promise','referred_introduction')),
 evidence jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists partnership_reservation_account_time on public.partnership_action_reservations(account_id,created_at);
alter table public.partnership_action_reservations enable row level security;
create table if not exists public.partnership_account_policy (
 account_id uuid primary key references public.partner_companies(id),
 not_before timestamptz,
 suppressed boolean not null default false,
 unresolved_promise boolean not null default false,
 pending_introduction boolean not null default false,
 evidence_ref text not null,
 updated_at timestamptz not null default now()
);
alter table public.partnership_account_policy enable row level security;
-- Policy events remain evidence; accepted reservation does not mean provider delivery.
create table if not exists public.partnership_policy_events (
 event_key text primary key,
 account_id uuid,
 action_key text not null,
 event_type text not null,
 evidence jsonb not null,
 occurred_at timestamptz not null default now(),
 recorded_at timestamptz not null default now()
);
alter table public.partnership_policy_events enable row level security;

create or replace function public.reserve_partnership_action(
 p_contact_id uuid,p_channel text,p_kind text,p_action_key text,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c record; a uuid; pol record; reasons text[] := '{}'; weekly integer; facts jsonb;
begin
 if p_channel not in ('email','sms','phone','direct_mail') or p_kind not in ('cold_introduction','reply','fulfil_promise','referred_introduction') or coalesce(length(p_action_key),0)<8 then
  raise exception 'Invalid partnership action';
 end if;
 select * into c from public.market_contacts where id=p_contact_id;
 if not found then return jsonb_build_object('allowed',false,'reasons',array['contact_missing']); end if;
 if p_kind='reply' and to_jsonb(c)->>'last_inbound_at' is null then p_kind:='cold_introduction'; end if;
 if p_kind in ('fulfil_promise','referred_introduction') then return jsonb_build_object('allowed',false,'reasons',array['structured_action_evidence_required']); end if;
 a:=c.partner_company_id;
 if a is null then return jsonb_build_object('allowed',false,'reasons',array['account_identity_required']); end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text,0));
 if exists(select 1 from public.partnership_action_reservations where action_key=p_action_key) then
  return jsonb_build_object('allowed',false,'reasons',array['existing_reservation_inspect_before_retry']);
 end if;
 -- Explicit facts supplied by the server adapter after the channel's own checks.
 if coalesce((p_evidence->>'marketActive')::boolean,false) is not true then reasons:=array_append(reasons,'market_not_active'); end if;
 if coalesce((p_evidence->>'serviceAvailable')::boolean,false) is not true then reasons:=array_append(reasons,'service_not_confirmed'); end if;
 if coalesce((p_evidence->>'channelEligible')::boolean,false) is not true then reasons:=array_append(reasons,'channel_not_eligible'); end if;
 if coalesce((p_evidence->>'senderHealthy')::boolean,false) is not true then reasons:=array_append(reasons,'sender_not_confirmed'); end if;
 if not (p_evidence ? 'observedAt') or (p_evidence->>'observedAt')::timestamptz<now()-interval '5 minutes' or (p_evidence->>'observedAt')::timestamptz>now()+interval '10 seconds' then reasons:=array_append(reasons,'stale_adapter_evidence'); end if;
 if exists(select 1 from public.market_contacts m where m.partner_company_id=a and (coalesce(m.do_not_contact,false) or to_jsonb(m)->>'cross_channel_suppressed_at' is not null or to_jsonb(m)->>'decision' in ('opted_out','rejected') or m.stage in ('dnc','do_not_contact'))) then reasons:=array_append(reasons,'account_suppressed'); end if;
 if p_channel='email' and (to_jsonb(c)->>'email_unsubscribed_at' is not null or to_jsonb(c)->>'email_status' in ('bounced','complained','unsubscribed')) then reasons:=array_append(reasons,'email_suppressed'); end if;
 select * into pol from public.partnership_account_policy where account_id=a;
 if found then
  if pol.suppressed then reasons:=array_append(reasons,'account_policy_suppressed'); end if;
  if pol.not_before>now() then reasons:=array_append(reasons,'requested_wait'); end if;
  if p_kind='cold_introduction' and (pol.unresolved_promise or pol.pending_introduction) then reasons:=array_append(reasons,'relationship_work_pending'); end if;
 end if;
 if p_kind='cold_introduction' then
  if exists(select 1 from public.partnership_action_reservations where contact_id=p_contact_id) or exists(select 1 from public.market_touches where contact_id=p_contact_id and direction='outbound') then reasons:=array_append(reasons,'existing_contact_outreach_review'); end if;
  if exists(select 1 from public.market_contacts m where m.partner_company_id=a and to_jsonb(m)->>'last_inbound_at' is not null) then reasons:=array_append(reasons,'account_has_inbound'); end if;
  -- Open accountable work must be reviewed rather than silently overwritten by a cold touch.
  if exists(select 1 from public.crm_tasks t where t.status in ('open','in_progress') and t.related_type in ('partner','relationship') and (t.related_id=a::text or t.related_id in(select id::text from public.market_contacts where partner_company_id=a))) then reasons:=array_append(reasons,'account_tasks_pending'); end if;
  if exists(select 1 from public.partner_referrals r where r.company_id=a and r.job_id is null and coalesce(r.job_status,'') not in ('lost','cancelled','completed')) then reasons:=array_append(reasons,'referral_pending'); end if;
  select count(distinct recipient) into weekly from (
   select r.contact_id recipient from public.partnership_action_reservations r where r.account_id=a and r.action_kind='cold_introduction' and r.created_at>now()-interval '7 days'
   union
   select t.contact_id from public.market_touches t join public.market_contacts m on m.id=t.contact_id where m.partner_company_id=a and t.direction='outbound' and t.created_at>now()-interval '7 days'
  ) recent;
  if weekly>=2 then reasons:=array_append(reasons,'account_weekly_recipient_limit'); end if;
 end if;
 facts:=jsonb_build_object('allowed',cardinality(reasons)=0,'reasons',reasons,'accountId',a,'policyVersion','cross-channel-v2','adapterEvidence',p_evidence);
 if cardinality(reasons)=0 then
  insert into public.partnership_action_reservations(action_key,account_id,contact_id,channel,action_kind,evidence) values(p_action_key,a,p_contact_id,p_channel,p_kind,facts);
  insert into public.partnership_policy_events(event_key,account_id,action_key,event_type,evidence) values('reserved:'||p_action_key,a,p_action_key,'action.reserved',facts);
 else
  insert into public.partnership_policy_events(event_key,account_id,action_key,event_type,evidence) values('held:'||gen_random_uuid()::text,a,p_action_key,'action.held',facts);
 end if;
 return facts;
end $$;
revoke all on function public.reserve_partnership_action(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_partnership_action(uuid,text,text,text,jsonb) to service_role;

create or replace function public.partnership_policy_append_only() returns trigger language plpgsql as $$
begin raise exception 'Partnership policy evidence is append-only'; end $$;
drop trigger if exists partnership_policy_events_immutable on public.partnership_policy_events;
create trigger partnership_policy_events_immutable before update or delete on public.partnership_policy_events for each row execute function public.partnership_policy_append_only();
grant select,insert on public.partnership_policy_events to service_role;
grant select,insert on public.partnership_action_reservations to service_role;
grant select,insert,update on public.partnership_account_policy to service_role;
