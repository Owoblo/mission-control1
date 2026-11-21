-- Owner instruction, 2026-09-28: realtor relationships are individual first, brokerage second.
-- Preserve recipient suppression, prior-send reservations and explicit organization-wide policy.
-- Scope only inherited brokerage reply holds and brokerage cold-recipient frequency limits.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:=$old$if exists(select 1 from public.market_contacts m where m.partner_company_id=a and to_jsonb(m)->>'last_inbound_at' is not null) then reasons:=array_append(reasons,'account_has_inbound'); end if;$old$;
 new_predicate:=$new$-- Realtors are individual relationships; shared brokerage membership is reporting context.
  if exists(select 1 from public.market_contacts m where
   (case when lower(btrim(coalesce(to_jsonb(c)->>'category','')))='realtor' then
    (m.id=c.id
     or (nullif(lower(btrim(c.email)),'') is not null and lower(btrim(m.email))=lower(btrim(c.email)))
     or (length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'))>=10 and right(regexp_replace(coalesce(m.phone,''),'[^0-9]','','g'),10)=right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),10)))
    else m.partner_company_id=a end)
   and to_jsonb(m)->>'last_inbound_at' is not null)
  then reasons:=array_append(reasons,case when lower(btrim(coalesce(to_jsonb(c)->>'category','')))='realtor' then 'recipient_has_inbound' else 'account_has_inbound' end); end if;$new$;
 if position(new_predicate in definition)=0 then
  if position(old_predicate in definition)=0 then raise exception 'Unexpected realtor policy predicate; inspect before applying'; end if;
  definition:=replace(definition,old_predicate,new_predicate);
 end if;
 old_predicate:=$old$if weekly>=2 then reasons:=array_append(reasons,'account_weekly_recipient_limit'); end if;$old$;
 new_predicate:=$new$if lower(btrim(coalesce(to_jsonb(c)->>'category','')))<>'realtor' and weekly>=2 then reasons:=array_append(reasons,'account_weekly_recipient_limit'); end if;$new$;
 if position(new_predicate in definition)=0 then
  if position(old_predicate in definition)=0 then raise exception 'Unexpected realtor policy predicate; inspect before applying'; end if;
  definition:=replace(definition,old_predicate,new_predicate);
 end if;
 execute definition;
end $migration$;
