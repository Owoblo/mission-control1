-- Owner-authorized, reviewed SMS-to-email follow-up. No automatic enrollment.
-- Keeps the existing reservation lock, opt-out, referral, task and account checks.
create or replace function public.reviewed_nonresponse_email_allowed(
 p_contact_id uuid,p_channel text,p_action_key text,p_evidence jsonb
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_channel='email' and exists (
  select 1 from market_contacts c join partnership_policy_events r
   on r.account_id=c.partner_company_id and r.action_key=p_action_key
  where c.id=p_contact_id and lower(c.category)='realtor'
   and r.event_key='nonresponse-review:'||p_action_key
   and r.event_type='nonresponse_email.reviewed'
   and p_action_key like 'owner-email-recovery-%'
   and r.evidence->>'contact_id'=c.id::text
   and r.evidence->>'recipient'=lower(btrim(c.email))
   and r.evidence->>'sender'=p_evidence->>'sender'
   and r.evidence->>'content_hash'=p_evidence->>'contentHash'
   and r.evidence->>'owner_authorized'='true'
   and r.evidence->>'context_complete'='true'
   and r.evidence->>'mailbox_checked'='true'
   and r.evidence->>'email_validation_status'='overall_valid_nonrisky'
   and nullif(btrim(r.evidence->>'reviewed_by'),'') is not null
   and r.evidence->>'source_url' like 'https://%'
   and r.occurred_at<=now() and r.occurred_at>now()-interval '1 hour'
   and (r.evidence->>'expires_at')::timestamptz>now()
   and (r.evidence->>'expires_at')::timestamptz<=r.occurred_at+interval '1 hour'
   and c.email_verification_status='valid'
   and c.email_verification_provider='aws_ses'
   and c.email_verification_checked_at>now()-interval '1 day'
   and c.last_inbound_at is null and c.email_last_replied_at is null
   and c.email_last_sent_at is null
   and exists(select 1 from market_touches t where t.contact_id=c.id
    and t.id::text=r.evidence->>'source_sms_touch_id'
    and t.channel='sms' and t.direction='outbound'
    and coalesce(t.metadata->>'twilioSid',t.metadata->>'provider_message_id') is not null)
   and not exists(select 1 from market_touches t where t.contact_id=c.id
    and (t.direction='inbound' or (t.channel='email' and t.direction='outbound')))
   and not exists(select 1 from partnership_action_reservations a where a.contact_id=c.id and a.channel='email')
   and not exists(select 1 from market_contacts other where other.id<>c.id
    and lower(btrim(other.email))=lower(btrim(c.email)))
 );
$$;
revoke all on function public.reviewed_nonresponse_email_allowed(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reviewed_nonresponse_email_allowed(uuid,text,text,jsonb) to service_role;
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:=$old$if exists(select 1 from public.partnership_action_reservations where contact_id=p_contact_id) or exists(select 1 from public.market_touches where contact_id=p_contact_id and direction='outbound') then reasons:=array_append(reasons,'existing_contact_outreach_review'); end if;$old$;
 new_predicate:=$new$if (exists(select 1 from public.partnership_action_reservations where contact_id=p_contact_id) or exists(select 1 from public.market_touches where contact_id=p_contact_id and direction='outbound'))
   and not public.reviewed_nonresponse_email_allowed(p_contact_id,p_channel,p_action_key,p_evidence)
  then reasons:=array_append(reasons,'existing_contact_outreach_review'); end if;$new$;
 if position(new_predicate in definition)>0 then return; end if;
 if position(old_predicate in definition)=0 then raise exception 'Unexpected existing-outreach policy; inspect before applying'; end if;
 execute replace(definition,old_predicate,new_predicate);
end $migration$;
