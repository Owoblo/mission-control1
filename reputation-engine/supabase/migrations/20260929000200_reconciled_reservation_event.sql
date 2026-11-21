-- Preserve append-only reservation history when a reviewed no-send attempt is retried.
-- Does not release reservations; caller must reconcile and explicitly release them first.
do $migration$
declare definition text; original text; replacement text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 original:=$old$values('reserved:'||p_action_key,a,p_action_key,'action.reserved',facts)$old$;
 replacement:=$new$values(
   case when exists(select 1 from public.partnership_policy_events e where e.action_key=p_action_key and e.event_type='action.reconciled_no_provider_record' and e.account_id=a and e.evidence->>'owner_authorized_retry'='true')
   then 'reserved-reconciled:'||p_action_key||':'||gen_random_uuid()::text
   else 'reserved:'||p_action_key end,a,p_action_key,'action.reserved',facts)$new$;
 if position(replacement in definition)>0 then return; end if;
 if position(original in definition)=0 then raise exception 'Unexpected reservation event insert'; end if;
 execute replace(definition,original,replacement);
end $migration$;
