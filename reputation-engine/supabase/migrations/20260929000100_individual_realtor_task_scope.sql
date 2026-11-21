-- Owner-authorized: pending tasks for one realtor must not block other brokerage members.
-- Keep direct-recipient/shared-identity tasks and explicitly account-linked tasks in scope.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:=$old$(t.related_id=a::text or t.related_id in(select id::text from public.market_contacts where partner_company_id=a))$old$;
 new_predicate:=$new$(t.related_id=a::text or t.related_id in(
  select m.id::text from public.market_contacts m where
   case when lower(btrim(coalesce(to_jsonb(c)->>'category','')))='realtor' then
    (m.id=c.id
     or (nullif(lower(btrim(c.email)),'') is not null and lower(btrim(m.email))=lower(btrim(c.email)))
     or (length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))>=10
      and right(regexp_replace(coalesce(m.phone,''),'[^0-9]','','g'),10)=right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)))
   else m.partner_company_id=a end
 ))$new$;
 if position(new_predicate in definition)>0 then return; end if;
 if position(old_predicate in definition)=0 then raise exception 'Unexpected task scope; inspect before applying'; end if;
 execute replace(definition,old_predicate,new_predicate);
end $migration$;
