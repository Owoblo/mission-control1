-- Owner instruction: another realtor's referral must not block individual introductions.
-- Preserve own/shared-identity referrals and unassigned account referrals.
do $migration$
declare definition text; original text; replacement text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 original:=$old$r.company_id=a and r.job_id is null$old$;
 replacement:=$new$r.company_id=a and (
  lower(btrim(coalesce(to_jsonb(c)->>'category','')))<>'realtor'
  or r.contact_id is null
  or r.contact_id in(select m.id from public.market_contacts m where m.id=c.id
   or (nullif(lower(btrim(c.email)),'') is not null and lower(btrim(m.email))=lower(btrim(c.email)))
   or (length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))>=10 and right(regexp_replace(coalesce(m.phone,''),'[^0-9]','','g'),10)=right(regexp_replace(c.phone,'[^0-9]','','g'),10)))
 ) and r.job_id is null$new$;
 if position(replacement in definition)>0 then return; end if;
 if position(original in definition)=0 then raise exception 'Unexpected referral policy'; end if;
 execute replace(definition,original,replacement);
end $migration$;
