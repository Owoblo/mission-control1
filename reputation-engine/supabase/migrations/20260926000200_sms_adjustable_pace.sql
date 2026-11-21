-- Remove the product daily ceiling. Keep bounded 1000-row transactions and recipient safeguards.
create or replace function public.enqueue_prepared_sms(p_campaign_key text,p_name text,p_rows jsonb,p_daily_cap integer default 1000)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; c public.market_contacts%rowtype; old_job public.sequence_jobs%rowtype; batch uuid; jid uuid; receipts jsonb:='[]'; destination text; matches integer;
begin
 if length(p_campaign_key)<8 or length(p_campaign_key)>160 or nullif(trim(p_name),'') is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 or (p_daily_cap is null or p_daily_cap < 1) then raise exception 'Invalid prepared campaign'; end if;
 -- Serializes prepared imports across campaign keys; recipient checks are repeated in this transaction.
 perform pg_advisory_xact_lock(hashtextextended('prepared-sms-enqueue',0));
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'phone','') !~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$' or coalesce(r->>'sender','') !~ '^\+1[0-9]{10}$' or nullif(trim(r->>'body'),'') is null or nullif(trim(r->>'company'),'') is null or nullif(trim(r->>'city'),'') is null or coalesce(r->>'execution_key','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid prepared recipient'; end if;
  destination:=regexp_replace(r->>'phone','\D','','g');
  select * into old_job from public.sequence_jobs where execution_key=r->>'execution_key';
  if found then
   if old_job.sms_payload->>'body' is distinct from r->>'body' or old_job.sms_payload->>'to' is distinct from r->>'phone' or old_job.sms_payload->>'from' is distinct from r->>'sender' then raise exception 'Idempotency key content conflict'; end if;
   receipts:=receipts||jsonb_build_array(jsonb_build_object('id',old_job.id,'replay',true,'status',old_job.status));
   continue;
  end if;
  select count(*) into matches from public.market_contacts where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=right(destination,10);
  if matches>1 then raise exception 'Ambiguous recipient identity'; end if;
  if matches=1 then
   select * into c from public.market_contacts where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=right(destination,10) for update;
   if coalesce(c.do_not_contact,false) or coalesce(c.sequence_paused,false) or c.stage in ('dnc','do_not_contact','closed_lost') or to_jsonb(c)->>'decision' in ('opted_out','rejected') or to_jsonb(c)->>'cross_channel_suppressed_at' is not null then raise exception 'Recipient suppressed or paused'; end if;
   if exists(select 1 from public.market_touches where contact_id=c.id and direction='outbound') or to_jsonb(c)->>'last_inbound_at' is not null then raise exception 'Existing conversation requires review'; end if;
   if exists(select 1 from public.sequence_jobs where contact_id=c.id and channel='sms' and status in ('pending','running','sent')) then raise exception 'Recipient already queued or sent'; end if;
   if regexp_replace(lower(coalesce(c.city,'')),'[^a-z0-9]','','g')<>regexp_replace(lower(r->>'city'),'[^a-z0-9]','','g') then raise exception 'Recipient location changed'; end if;
  else
   if exists(select 1 from public.market_contacts where lower(trim(name))=lower(trim(r->>'company')) or lower(trim(company))=lower(trim(r->>'company'))) then raise exception 'Existing name requires identity review'; end if;
   insert into public.market_contacts(name,company,phone,city,category,industry,stage,pipeline_phase,sequence_step,sequence_paused)
   values(r->>'company',r->>'company',r->>'phone',r->>'city',r->>'category',r->>'category','target','outreach',0,false) returning * into c;
  end if;
  -- The existing company-link trigger resolves supplied business identity; no synthetic account ID.
  if c.partner_company_id is null then raise exception 'Account identity required; company-link trigger unavailable'; end if;
  if nullif(r->>'scheduled_at','') is null or (r->>'scheduled_at')::timestamptz<now()-interval '1 minute' then raise exception 'Stale schedule; prepare again'; end if;
  if batch is null then
   insert into public.market_campaigns(name,tracking_code,tier,letters_sent,sent_date,cost_cents,notes)
   values(p_name,'prepared_'||p_campaign_key,1,0,current_date,0,jsonb_build_object('type','partnership_sms_campaign','template','Prepared per-recipient SMS','dailyCap',p_daily_cap,'senderNumbers',jsonb_build_array(r->>'sender'),'timezone','America/Toronto','startHour',10,'endHour',17,'source',p_campaign_key)::text) returning id into batch;
  end if;
  insert into public.sequence_jobs(contact_id,batch_id,channel,scheduled_at,status,template_key,execution_key,sms_payload)
  values(c.id,batch,'sms',(r->>'scheduled_at')::timestamptz,'pending','partnership_sms|'||(r->>'sender'),r->>'execution_key',jsonb_build_object('body',r->>'body','to',r->>'phone','from',r->>'sender','city',r->>'city','campaign_key',p_campaign_key)) returning id into jid;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('id',jid,'replay',false,'status','pending'));
 end loop;
 return jsonb_build_object('jobs',receipts,'campaign_id',batch);
end $$;
revoke all on function public.enqueue_prepared_sms(text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.enqueue_prepared_sms(text,text,jsonb,integer) to service_role;
