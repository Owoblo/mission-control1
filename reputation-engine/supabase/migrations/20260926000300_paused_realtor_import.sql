-- Source-ID ledger for paused realtor imports. Never creates a campaign or send job.
create table if not exists public.realtor_import_rows (
 source_key text primary key,
 source_file_sha256 text not null,
 source_record jsonb not null,
 contact_id uuid references public.market_contacts(id),
 status text not null check(status in ('imported_paused','held_existing_route')),
 created_at timestamptz not null default now()
);
alter table public.realtor_import_rows enable row level security;
revoke all on public.realtor_import_rows from public,anon,authenticated;
grant select,insert on public.realtor_import_rows to service_role;

create index if not exists market_contacts_import_email_idx on public.market_contacts ((lower(trim(email))));
create index if not exists market_contacts_import_external_id_idx on public.market_contacts ((substring(notes from E'(?:^|\\n)external_id=([0-9]+)(?:\\n|$)')));

create or replace function public.import_paused_realtors(p_rows jsonb,p_source_file_sha256 text,p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; prior public.realtor_import_rows%rowtype; matches integer; cid uuid; result jsonb:='[]'; sk text; candidate_phones text[];
begin
 if p_source_file_sha256 is null or p_source_file_sha256 !~ '^[a-f0-9]{64}$' or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 or p_dry_run is null then raise exception 'Invalid paused import'; end if;
 -- Serialize source imports; unrelated CRM writes remain protected by immediate route rechecks.
 perform pg_advisory_xact_lock(hashtextextended('paused-realtor-import',0));
 -- Block concurrent writes while checking routes and inserting this bounded chunk.
 lock table public.market_contacts in share row exclusive mode;
 for r in select value from jsonb_array_elements(p_rows) loop
  sk:='realtor-ca:'||(r->>'individual_id');
  if coalesce(r->>'individual_id','') !~ '^[0-9]+$' or nullif(trim(r->>'name'),'') is null or nullif(trim(r->>'brokerage'),'') is null or nullif(trim(r->>'city'),'') is null or coalesce(r->>'phone','') !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' or r->>'market' is distinct from 'toronto' then raise exception 'Invalid realtor identity'; end if;
  select * into prior from public.realtor_import_rows where source_key=sk;
  if found then
   if prior.source_record is distinct from r then
    result:=result||jsonb_build_array(jsonb_build_object('source_key',sk,'status','held_source_changed','contact_id',prior.contact_id));
   else
    result:=result||jsonb_build_array(jsonb_build_object('source_key',sk,'status',prior.status,'contact_id',prior.contact_id,'replay',true));
   end if;
   continue;
  end if;
  candidate_phones:=array[regexp_replace(r->>'phone','\D','','g'),regexp_replace(coalesce(r->>'phone2',''),'\D','','g'),regexp_replace(coalesce(r->>'phone3',''),'\D','','g')];
  select count(*) into matches from (
    select c.id from public.market_contacts c where right(regexp_replace(coalesce(c.phone,''),'\D','','g'),10) = any(array(select right(p,10) from unnest(candidate_phones) p where length(p)>=10))
    union
    select c.id from public.market_contacts c where nullif(trim(r->>'email'),'') is not null and lower(trim(c.email))=lower(trim(r->>'email'))
    union
    select c.id from public.market_contacts c where lower(trim(c.name))=lower(trim(r->>'name'))
    union
    select c.id from public.market_contacts c where substring(c.notes from E'(?:^|\\n)external_id=([0-9]+)(?:\\n|$)')=r->>'individual_id'
  ) existing_matches;
  if matches>0 then
   if not p_dry_run then insert into public.realtor_import_rows(source_key,source_file_sha256,source_record,status) values(sk,p_source_file_sha256,r,'held_existing_route'); end if;
   result:=result||jsonb_build_array(jsonb_build_object('source_key',sk,'status','held_existing_route','matches',matches));continue;
  end if;
  if p_dry_run then
   result:=result||jsonb_build_array(jsonb_build_object('source_key',sk,'status','would_import_paused'));continue;
  end if;
  -- Unverified email and secondary routes stay in the source ledger/notes, not active send fields.
  insert into public.market_contacts(name,company,title,phone,city,category,industry,stage,pipeline_phase,sequence_step,sequence_paused,sequence_paused_reason,notes)
  values(trim(r->>'name'),trim(r->>'brokerage'),nullif(trim(r->>'position'),''),r->>'phone',r->>'city','realtor','Real Estate','target','outreach',0,true,'gta_launch_review',
   'source_key='||sk||E'\nexternal_id='||(r->>'individual_id')||E'\nsource_file_sha256='||p_source_file_sha256||E'\nmarket=toronto\nprofile='||coalesce(r->>'profile_url','')||E'\nphone2='||coalesce(r->>'phone2','')||E'\nphone3='||coalesce(r->>'phone3','')||E'\nemail_pending_verification='||coalesce(r->>'email','')||E'\nchannel_checks=pending\nconsent=owner_confirmed_2026-09-26') returning id into cid;
  insert into public.realtor_import_rows(source_key,source_file_sha256,source_record,contact_id,status) values(sk,p_source_file_sha256,r,cid,'imported_paused');
  result:=result||jsonb_build_array(jsonb_build_object('source_key',sk,'status','imported_paused','contact_id',cid));
 end loop;
 return jsonb_build_object('dry_run',p_dry_run,'rows',result,'queued',0,'sent',0);
end $$;
revoke all on function public.import_paused_realtors(jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.import_paused_realtors(jsonb,text,boolean) to service_role;
