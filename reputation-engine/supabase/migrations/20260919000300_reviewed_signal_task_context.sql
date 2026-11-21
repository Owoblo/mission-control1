-- Reuse the service-only policy event log and existing cold-introduction action.
-- Reviewed work stays open. Only an unchanged task snapshot may be accounted for.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:=$old$if exists(select 1 from public.crm_tasks t where t.status in ('open','in_progress') and t.related_type in ('partner','relationship') and (t.related_id=a::text or t.related_id in(select id::text from public.market_contacts where partner_company_id=a))) then reasons:=array_append(reasons,'account_tasks_pending'); end if;$old$;
 new_predicate:=$new$if exists(select 1 from public.crm_tasks t
 where t.status in ('open','in_progress') and t.related_type in ('partner','relationship')
 and (t.related_id=a::text or t.related_id in(select id::text from public.market_contacts where partner_company_id=a))
 and not exists(select 1 from public.partnership_policy_events review
  where review.event_key='signal-review:'||p_action_key
  and review.event_type='signal_introduction.reviewed' and review.action_key=p_action_key
  and review.account_id=a and review.evidence->>'contact_id'=p_contact_id::text
  and p_channel='email' and review.evidence->>'channel'=p_channel
  and review.evidence->>'recipient'=c.email
  and review.evidence->>'sender'=p_evidence->>'sender'
  and review.evidence->>'content_hash'=p_evidence->>'contentHash'
  and nullif(btrim(review.evidence->>'reviewed_by'),'') is not null
  and review.evidence->>'source_url' like 'https://%'
  and review.occurred_at<=now()
  and (review.evidence->>'expires_at')::timestamptz>now()
  and (review.evidence->>'expires_at')::timestamptz<=review.occurred_at+interval '1 day'
  and review.evidence->'reviewed_tasks' @> jsonb_build_array(to_jsonb(t))
 )) then reasons:=array_append(reasons,'account_tasks_pending'); end if;$new$;
 if position(new_predicate in definition)>0 then return; end if;
 if position(old_predicate in definition)=0 then raise exception 'Unexpected task policy predicate; inspect before applying'; end if;
 execute replace(definition,old_predicate,new_predicate);
end $migration$;
