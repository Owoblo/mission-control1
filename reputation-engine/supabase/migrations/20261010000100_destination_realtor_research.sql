-- Discovery only: this queue has no outbound delivery capability.
create table if not exists public.destination_realtor_jobs (
  lead_id text primary key references public.crm_leads(id),
  property_key text not null,
  state text not null default 'pending' check (state in ('pending','running','done','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.destination_realtor_jobs enable row level security;
revoke all on public.destination_realtor_jobs from anon, authenticated;
grant all on public.destination_realtor_jobs to service_role;

create or replace function public.reconcile_destination_opportunity(
  source_id text, source_version timestamptz, opportunity jsonb, opportunity_version timestamptz,
  source_status text, property_key text
) returns boolean language plpgsql security definer set search_path=public as $$
declare existing_version timestamptz;
begin
  perform 1 from crm_leads where id=source_id and not deleted and updated_at=source_version for update;
  if not found then return false; end if;
  if opportunity is not null then
    select updated_at into existing_version from crm_leads where id=opportunity->>'id' for update;
    if found and (opportunity_version is null or existing_version<>opportunity_version) then return false; end if;
    insert into crm_leads(id,data,deleted,updated_at) values(opportunity->>'id',opportunity,false,clock_timestamp())
    on conflict(id) do update set data=excluded.data, updated_at=excluded.updated_at;
    if opportunity#>>'{realtorResearch,status}'='pending' then
      insert into destination_realtor_jobs(lead_id,property_key) values(opportunity->>'id',property_key)
      on conflict(lead_id) do update set property_key=excluded.property_key,state='pending',attempts=0,
        available_at=now(),claimed_at=null,last_error=null,updated_at=clock_timestamp()
      where destination_realtor_jobs.property_key<>excluded.property_key or destination_realtor_jobs.state in ('done','failed');
    end if;
  end if;
  update crm_leads set data=(data - 'destinationOpportunityLeadId') || jsonb_build_object(
    'destinationOpportunityStatus',source_status,'destinationOpportunityLastCheckedAt',now()) ||
    case when opportunity is null then '{}'::jsonb else jsonb_build_object('destinationOpportunityLeadId',opportunity->>'id') end,
    updated_at=clock_timestamp() where id=source_id;
  return true;
end $$;

create or replace function public.claim_destination_realtor_job() returns setof public.destination_realtor_jobs
language sql security definer set search_path=public as $$
  update destination_realtor_jobs set state='running',attempts=attempts+1,claimed_at=clock_timestamp(),updated_at=clock_timestamp()
  where lead_id=(select lead_id from destination_realtor_jobs where
    (state='pending' and available_at<=now()) or (state='running' and claimed_at<now()-interval '10 minutes')
    order by available_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.reconcile_destination_opportunity(text,timestamptz,jsonb,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.claim_destination_realtor_job() from public,anon,authenticated;
grant execute on function public.reconcile_destination_opportunity(text,timestamptz,jsonb,timestamptz,text,text) to service_role;
grant execute on function public.claim_destination_realtor_job() to service_role;

-- Catch destination/date changes through quote and intake paths as well as Sales PATCH.
create or replace function public.next_destination_source() returns setof jsonb
language sql security definer set search_path=public as $$
  select s.data from crm_leads s left join crm_leads o on o.id=s.data->>'destinationOpportunityLeadId' and not o.deleted
  where not s.deleted and coalesce(s.data->>'leadKind','customer')='customer'
    and nullif(s.data->>'destAddress','') is not null
    and coalesce(o.data->>'primaryContactRole','realtor')='realtor'
    and (
      (o.id is not null and (
        s.data->>'destAddress' is distinct from o.data->>'opportunityAddress'
        or coalesce(nullif(s.data->>'destCity',''),btrim(split_part(s.data->>'destAddress',',',2))) is distinct from o.data->>'opportunityCity'
        or s.data->>'moveDate' is distinct from o.data->>'sourceLeadMoveDate'
        or ((s.data->>'stage' in ('lost','completed') or s.data->>'moveDate'<to_char(now() at time zone 'America/Toronto','YYYY-MM-DD'))
          and o.data#>>'{realtorResearch,status}' is distinct from 'stale')
      ))
      or ((o.id is null or o.data#>>'{realtorResearch,status}' in ('stale','failed')) and coalesce(s.data->>'stage','new') not in ('lost','completed')
        and coalesce(s.data->>'moveDate','9999-12-31')>=to_char(now() at time zone 'America/Toronto','YYYY-MM-DD')
        and coalesce(s.data->>'destinationOpportunityLastCheckedAt','')<to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS'))
    ) order by s.updated_at desc limit 1;
$$;
revoke all on function public.next_destination_source() from public,anon,authenticated;
grant execute on function public.next_destination_source() to service_role;
