create table public.partnership_promotion_receipts (
  sequence_job_id uuid primary key references public.sequence_jobs(id),
  artifact_path text not null,
  artifact_recipient_id text not null,
  market_contact_id uuid not null references public.market_contacts(id),
  partner_company_id uuid not null references public.partner_companies(id),
  campaign_key text not null,
  cleared_holds jsonb not null,
  approved_by text not null,
  evidence jsonb not null,
  promoted_at timestamptz not null default now(),
  unique (campaign_key,artifact_recipient_id)
);
alter table public.partnership_promotion_receipts enable row level security;
revoke all on public.partnership_promotion_receipts from public,anon,authenticated;
grant select on public.partnership_promotion_receipts to service_role;

create function public.promote_research_sms(p_campaign_key text,p_name text,p_rows jsonb,p_daily_cap integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; r jsonb; l jsonb; j public.sequence_jobs; prior public.partnership_promotion_receipts;
begin
  result := public.enqueue_prepared_sms(p_campaign_key,p_name,p_rows,p_daily_cap);
  for r in select value from jsonb_array_elements(p_rows) loop
    l := r->'lineage';
    if nullif(trim(l->>'approved_by'),'') is null or nullif(trim(l->>'artifact_path'),'') is null
      or nullif(trim(l->>'artifact_recipient_id'),'') is null or jsonb_typeof(l->'cleared_holds') is distinct from 'array'
      or coalesce(r->'reviewReasons','[]') <> '[]'::jsonb then raise exception 'Incomplete release decision'; end if;
    if jsonb_typeof(l->'original_holds') is distinct from 'array'
      or (l->'original_holds') <> (l->'cleared_holds')
      or (l->'cleared_holds') ? 'coordinate_single_triland_team_introduction'
      or ((l->'cleared_holds') ? 'recipient_specific_release_basis_unconfirmed' and nullif(trim(l->>'release_evidence'),'') is null)
      then raise exception 'Unresolved research holds'; end if;
    select * into strict j from public.sequence_jobs where execution_key=r->>'execution_key';
    select * into prior from public.partnership_promotion_receipts where sequence_job_id=j.id;
    if found then
      if prior.evidence <> l then raise exception 'Conflicting promotion replay'; end if;
    else
      if exists(select 1 from jsonb_array_elements(result->'jobs') x where x->>'id'=j.id::text and (x->>'replay')::boolean)
        then raise exception 'Existing job has no matching promotion receipt'; end if;
      insert into public.partnership_promotion_receipts
        (sequence_job_id,artifact_path,artifact_recipient_id,market_contact_id,partner_company_id,campaign_key,cleared_holds,approved_by,evidence)
      select j.id,l->>'artifact_path',l->>'artifact_recipient_id',c.id,c.partner_company_id,p_campaign_key,l->'cleared_holds',l->>'approved_by',l
      from public.market_contacts c where c.id=j.contact_id;
    end if;
  end loop;
  return result;
end $$;
revoke all on function public.promote_research_sms(text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.promote_research_sms(text,text,jsonb,integer) to service_role;

create view public.partnership_promotion_outcomes with (security_invoker=true) as
select r.sequence_job_id as id,r.campaign_key,r.artifact_recipient_id,
 (j.status='sent' and nullif(j.provider_sid,'') is not null) as provider_accepted,
 (exists(select 1 from public.crm_sms_provider_events e where e.message_key=j.provider_sid and lower(e.status)='delivered')
  or exists(select 1 from public.market_touches t where t.contact_id=r.market_contact_id and t.channel='sms'
    and t.direction='inbound' and t.created_at>=j.sent_at and (
       t.metadata->>'sequence_job_id'=j.id::text or t.metadata->>'in_reply_to'=j.provider_sid or
       (t.metadata->>'to'=j.sms_payload->>'from' and t.metadata->>'from'=j.sms_payload->>'to'
        and not exists(select 1 from public.market_touches later where later.contact_id=t.contact_id
          and later.channel='sms' and later.direction='outbound' and later.created_at>=j.sent_at
          and later.created_at<=t.created_at and (later.metadata->>'sequence_job_id') is distinct from j.id::text))))
 ) as delivered_or_replied
from public.partnership_promotion_receipts r join public.sequence_jobs j on j.id=r.sequence_job_id;
revoke all on public.partnership_promotion_outcomes from public,anon,authenticated;
grant select on public.partnership_promotion_outcomes to service_role;
