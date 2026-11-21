-- Owner authorized the reviewed non-GTA shortlist on October 10.
-- Expand category eligibility only for this batch and a matching reviewed category.
do $migration$
declare definition text; original text; replacement text;
begin
 definition:=pg_get_functiondef('public.reviewed_nonresponse_email_allowed(uuid,text,text,jsonb)'::regprocedure);
 original:=$old$where c.id=p_contact_id and lower(c.category)='realtor'$old$;
 replacement:=$new$where c.id=p_contact_id and (
  lower(c.category)='realtor' or (
   p_action_key like 'owner-email-recovery-regions-20261010:%'
   and r.evidence->>'category_reviewed'='true'
   and r.evidence->>'contact_category'=coalesce(c.category,'')
  )
 )$new$;
 if position(replacement in definition)>0 then return; end if;
 if position(original in definition)=0 then raise exception 'Unexpected reviewed email policy; inspect before migration'; end if;
 execute replace(definition,original,replacement);
end $migration$;
