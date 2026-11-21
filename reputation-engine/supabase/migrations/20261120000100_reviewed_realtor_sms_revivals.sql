-- Allow reviewed Realtor revivals against a specific quiet CRM conversation.
create or replace function public.enqueue_prepared_sms(p_campaign_key text,p_name text,p_rows jsonb,p_daily_cap integer default 1000)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; c public.market_contacts%rowtype; old_job public.sequence_jobs%rowtype; batch uuid; jid uuid; receipts jsonb:='[]'; destination text; matches integer; agent_name text; revival boolean; prior_touch text; prior_at timestamptz; l jsonb;
begin
 if length(p_campaign_key)<8 or length(p_campaign_key)>160 or nullif(trim(p_name),'') is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or (p_daily_cap is null or p_daily_cap < 1) then raise exception 'Invalid prepared campaign'; end if;
 -- Serializes prepared imports across campaign keys; recipient checks are repeated in this transaction.
 perform pg_advisory_xact_lock(hashtextextended('prepared-sms-enqueue',0));
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'phone','') !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' or coalesce(r->>'sender','') !~ '^\+1[0-9]{10}$' or nullif(trim(r->>'body'),'') is null or nullif(trim(r->>'company'),'') is null or nullif(trim(r->>'city'),'') is null or coalesce(r->>'execution_key','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid prepared recipient'; end if;
  revival := coalesce(r->'allowRevival' = 'true'::jsonb, false)
    or coalesce(r->'allow_revival' = 'true'::jsonb, false);
  prior_touch := r->>'priorSmsTouchId';
  l := r->'lineage';
  if revival and (
    coalesce(r->'reviewReasons','[]') <> '[]'::jsonb
    or nullif(btrim(l->>'approved_by'),'') is null
    or nullif(btrim(l->>'artifact_recipient_id'),'') is null
    or nullif(btrim(l->>'artifact_path'),'') is null
    or jsonb_typeof(l->'original_holds') is distinct from 'array'
    or l->'cleared_holds' is distinct from l->'original_holds'
    or l->'original_holds' ?| array['approved_sms_disclosure_unverified','coordinate_single_triland_team_introduction']
    or nullif(btrim(l #>> '{release_evidence,publication_source}'),'') is null
    or nullif(btrim(l #>> '{release_evidence,publication_proof}'),'') is null
    or nullif(btrim(l #>> '{release_evidence,business_role,proof}'),'') is null
    or prior_touch is null
    or l->>'prior_sms_touch_id' is distinct from prior_touch
    or (r->>'execution_key') <> encode(sha256(convert_to('prepared-sms-revival:'||prior_touch,'UTF8')),'hex')
  ) then raise exception 'Incomplete revival release decision'; end if;
  destination:=regexp_replace(r->>'phone','\D','','g');
  select * into old_job from public.sequence_jobs where execution_key=r->>'execution_key';
  if found then
   if old_job.sms_payload->>'body' is distinct from r->>'body' or old_job.sms_payload->>'to' is distinct from r->>'phone' or old_job.sms_payload->>'from' is distinct from r->>'sender' then raise exception 'Idempotency key content conflict'; end if;
   if revival and old_job.sms_payload->>'prior_sms_touch_id' is distinct from prior_touch then raise exception 'Idempotency key conversation conflict'; end if;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('id',old_job.id,'replay',true,'status',old_job.status));
   continue;
  end if;
  agent_name := case when regexp_replace(lower(r->>'category'),'[^a-z0-9]','','g') in ('realtor','realestateagent','realestate') then nullif(btrim(r->>'contactName'),'') end;
  if revival and agent_name is null then raise exception 'Revival requires a Realtor identity'; end if;
  if agent_name is not null and exists (
    select 1 from public.market_contacts m
    where lower(regexp_replace(btrim(m.name),'[[:space:]]+',' ','g'))=lower(regexp_replace(agent_name,'[[:space:]]+',' ','g'))
      and lower(regexp_replace(btrim(m.company),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(r->>'company'),'[[:space:]]+',' ','g'))
      and right(regexp_replace(coalesce(m.phone,''),'[^0-9]','','g'),10)<>right(destination,10)
  ) then raise exception 'Agent phone requires identity review'; end if;
  select count(*) into matches from public.market_contacts where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=right(destination,10);
  if matches>1 then raise exception 'Ambiguous recipient identity'; end if;
  if matches=1 then
   select * into c from public.market_contacts where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=right(destination,10) for update;
   if agent_name is not null and (
    lower(regexp_replace(btrim(c.name),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(agent_name,'[[:space:]]+',' ','g')) or
    lower(regexp_replace(btrim(c.company),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(r->>'company'),'[[:space:]]+',' ','g'))
   ) then raise exception 'Agent identity conflict'; end if;
   if coalesce(c.do_not_contact,false) or coalesce(c.sequence_paused,false) or c.stage in ('dnc','do_not_contact','closed_lost') or to_jsonb(c)->>'decision' in ('opted_out','rejected') or to_jsonb(c)->>'cross_channel_suppressed_at' is not null
      or coalesce(to_jsonb(c)->>'notes','') ~* '^[[:space:]]*(Inbound SMS:[[:space:]]*)?(stop|unsubscribe|remove|do not text|don''t text|dont text|opt out|cancel)\y' then raise exception 'Recipient suppressed or paused'; end if;
   if to_jsonb(c)->>'last_inbound_at' is not null or exists(
     select 1 from public.market_touches where contact_id=c.id and direction='inbound'
   ) then raise exception 'Existing conversation requires review'; end if;
   if revival then
    select created_at into prior_at from public.market_touches
    where contact_id=c.id and id::text=prior_touch and direction='outbound' and channel='sms';
    if prior_at is null or prior_at > now()-interval '1080 hours' or exists (
      select 1 from public.market_touches where contact_id=c.id and id::text<>prior_touch
        and (created_at is null or created_at >= prior_at)
    ) then raise exception 'Revival conversation changed or quiet period not met'; end if;
   elsif exists(select 1 from public.market_touches where contact_id=c.id and direction='outbound') then
    raise exception 'Existing conversation requires review';
   end if;
   if exists(select 1 from public.sequence_jobs where contact_id=c.id and channel='sms'
     and (status in ('pending','running','processing') or (status='sent' and not revival)))
   then raise exception 'Recipient already queued or sent'; end if;
   if regexp_replace(lower(coalesce(c.city,'')),'[^a-z0-9]','','g')<>regexp_replace(lower(r->>'city'),'[^a-z0-9]','','g') then raise exception 'Recipient location changed'; end if;
  else
   if revival then raise exception 'Revival requires an existing contact'; end if;
   if agent_name is null and exists(select 1 from public.market_contacts where lower(trim(name))=lower(trim(r->>'company')) or lower(trim(company))=lower(trim(r->>'company'))) then raise exception 'Existing name requires identity review'; end if;
   insert into public.market_contacts(name,company,phone,city,category,industry,stage,pipeline_phase,sequence_step,sequence_paused)
   values(coalesce(agent_name,r->>'company'),r->>'company',r->>'phone',r->>'city',case when agent_name is null then r->>'category' else 'Realtor' end,r->>'category','target','outreach',0,false) returning * into c;
  end if;
  -- The existing company-link trigger resolves supplied business identity; no synthetic account ID.
  if c.partner_company_id is null then raise exception 'Account identity required; company-link trigger unavailable'; end if;
  if nullif(r->>'scheduled_at','') is null or (r->>'scheduled_at')::timestamptz<now()-interval '1 minute' then raise exception 'Stale schedule; prepare again'; end if;
  if batch is null then
   insert into public.market_campaigns(name,tracking_code,tier,letters_sent,sent_date,cost_cents,notes)
   values(p_name,'prepared_'||p_campaign_key,1,0,current_date,0,jsonb_build_object('type','partnership_sms_campaign','template','Prepared per-recipient SMS','dailyCap',p_daily_cap,'senderNumbers',jsonb_build_array(r->>'sender'),'timezone','America/Toronto','startHour',10,'endHour',17,'source',p_campaign_key)::text) returning id into batch;
  end if;
  insert into public.sequence_jobs(contact_id,batch_id,channel,scheduled_at,status,template_key,execution_key,sms_payload)
  values(c.id,batch,'sms',(r->>'scheduled_at')::timestamptz,'pending','partnership_sms|'||(r->>'sender'),r->>'execution_key',jsonb_build_object('body',r->>'body','to',r->>'phone','from',r->>'sender','city',r->>'city','campaign_key',p_campaign_key)
    || case when revival then jsonb_build_object('prior_sms_touch_id',prior_touch) else '{}'::jsonb end) returning id into jid;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('id',jid,'replay',false,'status','pending'));
 end loop;
 return jsonb_build_object('jobs',receipts,'campaign_id',batch);
end $$;
revoke all on function public.enqueue_prepared_sms(text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.enqueue_prepared_sms(text,text,jsonb,integer) to service_role;

create or replace function public.promote_research_sms(p_campaign_key text,p_name text,p_rows jsonb,p_daily_cap integer)
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
    if (coalesce(r->'allowRevival' = 'true'::jsonb,false) or coalesce(r->'allow_revival' = 'true'::jsonb,false))
      and j.sms_payload->>'prior_sms_touch_id' is distinct from l->>'prior_sms_touch_id'
      then raise exception 'Revival receipt does not match the reviewed conversation'; end if;
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

