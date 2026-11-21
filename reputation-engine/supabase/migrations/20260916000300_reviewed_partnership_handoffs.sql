-- A reviewed handoff is specific to one contact route and a genuine human referral.
create table if not exists public.partnership_reviewed_handoffs (
 contact_id uuid primary key references public.market_contacts(id),
 account_id uuid not null references public.partner_companies(id),
 source_touch_id uuid not null references public.market_touches(id),
 channel text not null check(channel in ('email','sms','phone')),
 target_route text not null,
 route_source_url text not null check(route_source_url like 'https://%'),
 review_note text not null,
 reviewed_by text not null,
 reviewed_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 check(expires_at>reviewed_at and expires_at<=reviewed_at+interval '7 days')
);
alter table public.partnership_reviewed_handoffs enable row level security;
revoke all on public.partnership_reviewed_handoffs from public,anon,authenticated;
grant select,insert,update on public.partnership_reviewed_handoffs to service_role;

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
 if p_kind='fulfil_promise' then return jsonb_build_object('allowed',false,'reasons',array['structured_action_evidence_required']); end if;
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
 if p_kind='referred_introduction' then
  if not exists (
   select 1 from public.partnership_reviewed_handoffs h
   join public.market_touches t on t.id=h.source_touch_id
   join public.market_contacts origin on origin.id=t.contact_id
   where h.contact_id=p_contact_id and h.account_id=a and h.channel=p_channel
    and h.expires_at>now() and h.revoked_at is null
    and h.target_route=case when p_channel='email' then lower(c.email) else c.phone end
    and origin.partner_company_id=a and t.direction='inbound'
    and t.outcome_code='referred_contact' and t.metadata->>'human_reply'='true'
  ) then reasons:=array_append(reasons,'reviewed_handoff_required'); end if;
  if exists(select 1 from public.partnership_action_reservations where contact_id=p_contact_id)
     or exists(select 1 from public.market_touches where contact_id=p_contact_id and direction='outbound') then
   reasons:=array_append(reasons,'handoff_already_attempted');
  end if;
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

