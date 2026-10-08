-- Reviewed handoffs are per job. A transaction owns both the lead and its task.
create or replace function public.create_reviewed_partner_handoff(p_contact text, p_lead jsonb, p_task jsonb, p_separate_job boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare existing public.crm_leads%rowtype; latest text; c public.market_contacts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('partner-handoff:' || p_contact, 0));
  select * into c from public.market_contacts where id::text = p_contact for update;
  if not found then raise exception 'Contact not found'; end if;
  if coalesce((to_jsonb(c)->>'do_not_contact')::boolean,false) or nullif(to_jsonb(c)->>'cross_channel_suppressed_at','') is not null then raise exception 'Contact is suppressed'; end if;
  if p_lead->>'partnerReferralContactId' is distinct from p_contact or p_lead->>'id' is distinct from ('partner-handoff-' || p_contact || '-' || (p_lead#>>'{partnerHandoff,sourceTouchId}')) then raise exception 'Invalid handoff identity'; end if;
  select * into existing from public.crm_leads where id = p_lead->>'id';
  if found then
    if existing.deleted then raise exception 'This opportunity was deleted; review it before creating another'; end if;
    return jsonb_build_object('id',existing.id,'reused',true);
  end if;
  if not exists(select 1 from public.market_touches where contact_id::text=p_contact and id::text=p_lead#>>'{partnerHandoff,sourceTouchId}') then raise exception 'Source message does not belong to contact'; end if;
  select id::text into latest from public.market_touches where contact_id::text=p_contact order by created_at desc,id desc limit 1;
  if latest is distinct from p_lead#>>'{partnerHandoff,reviewedThroughTouchId}' then raise exception 'Conversation changed. Reload and review the latest reply'; end if;
  if not p_separate_job and exists(select 1 from public.crm_leads where not coalesce(deleted,false) and (data->>'partnerReferralContactId'=p_contact or (length(regexp_replace(coalesce(p_lead->>'phone',''),'[^0-9]','','g'))>=10 and right(regexp_replace(coalesce(data->>'phone',''),'[^0-9]','','g'),10)=right(regexp_replace(p_lead->>'phone','[^0-9]','','g'),10)))) then raise exception 'Open the existing opportunity or confirm this is a separate job'; end if;
  insert into public.crm_leads(id,data,deleted,updated_at) values(p_lead->>'id',p_lead,false,now());
  insert into public.crm_tasks(id,title,description,status,priority,category,due_at,owner_user_id,owner_name,branch,related_type,related_id,related_label,source,source_key,created_by_user_id,created_by_name)
  values(p_task->>'id',p_task->>'title',p_task->>'description','open','high','sales',(p_task->>'due_at')::timestamptz,p_task->>'owner_user_id',p_task->>'owner_name',p_lead->>'branch','lead',p_lead->>'id',p_lead->>'name','manual',p_task->>'id',p_task->>'created_by_user_id',p_task->>'created_by_name');
  update public.market_contacts set sequence_paused=true,sequence_paused_reason='reviewed_sales_handoff' where id::text=p_contact;
  return jsonb_build_object('id',p_lead->>'id','reused',false);
end $$;
revoke all on function public.create_reviewed_partner_handoff(text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.create_reviewed_partner_handoff(text,jsonb,jsonb,boolean) to service_role;

create or replace function public.update_reviewed_partner_handoff(p_id text,p_expected jsonb,p_brief jsonb,p_status text,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.crm_leads%rowtype;
begin
  select * into row from public.crm_leads where id=p_id for update;
  if not found or coalesce(row.deleted,false) then raise exception 'Opportunity not found'; end if;
  if row.data->'partnerHandoff' is distinct from p_expected then raise exception 'Handoff changed. Reload before updating'; end if;
  if p_status not in ('new','in_progress','needs_partner_follow_up','completed') then raise exception 'Invalid status'; end if;
  update public.crm_leads set data=data || jsonb_build_object('partnerHandoff',p_brief,'handoffStatus',p_status,'followUpNote',p_brief->>'nextAction','followUpDate',left(p_brief->>'dueAt',10),'updatedAt',now()),updated_at=now() where id=p_id;
  update public.crm_tasks set status=case when p_status='completed' then 'completed' when p_status='in_progress' then 'in_progress' else 'open' end,
    description=(p_brief->>'summary') || E'\nNext: ' || (p_brief->>'nextAction') || E'\nContact: ' || (p_brief->>'callbackPermission') || E'\nOutcome: ' || coalesce(p_brief->>'outcome',''),
    due_at=(p_brief->>'dueAt')::timestamptz,updated_at=now(),outcome_note=p_brief->>'outcome',
    completed_at=case when p_status='completed' then now() else null end,completed_by_name=case when p_status='completed' then p_actor else null end
    where source_key='handoff-task-' || p_id;
  return jsonb_build_object('id',p_id);
end $$;
revoke all on function public.update_reviewed_partner_handoff(text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.update_reviewed_partner_handoff(text,jsonb,jsonb,text,text) to service_role;
