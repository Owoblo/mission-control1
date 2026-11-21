-- A person's opt-out must not suppress unrelated people at their brokerage.
-- Explicit organization-wide restrictions remain in partnership_account_policy.
-- Preserve all other deployed reservation logic; fail if its known predicate changed.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
 definition:=pg_get_functiondef('public.reserve_partnership_action(uuid,text,text,text,jsonb)'::regprocedure);
 old_predicate:=$old$if exists(select 1 from public.market_contacts m where m.partner_company_id=a and (coalesce(m.do_not_contact,false) or to_jsonb(m)->>'cross_channel_suppressed_at' is not null or to_jsonb(m)->>'decision' in ('opted_out','rejected') or m.stage in ('dnc','do_not_contact'))) then reasons:=array_append(reasons,'account_suppressed'); end if;$old$;
 new_predicate:=$new$if exists(
  select 1 from public.market_contacts m
  where (
   m.id=c.id
   or (nullif(lower(btrim(to_jsonb(c)->>'email')),'') is not null and lower(btrim(to_jsonb(m)->>'email'))=lower(btrim(to_jsonb(c)->>'email')))
   or (length(regexp_replace(coalesce(to_jsonb(c)->>'phone',''),'[^0-9]','','g'))>=10 and
    (case when length(regexp_replace(coalesce(to_jsonb(m)->>'phone',''),'[^0-9]','','g'))=10 then '1' else '' end || regexp_replace(coalesce(to_jsonb(m)->>'phone',''),'[^0-9]','','g')) =
    (case when length(regexp_replace(coalesce(to_jsonb(c)->>'phone',''),'[^0-9]','','g'))=10 then '1' else '' end || regexp_replace(coalesce(to_jsonb(c)->>'phone',''),'[^0-9]','','g')))
  ) and (coalesce(m.do_not_contact,false) or to_jsonb(m)->>'cross_channel_suppressed_at' is not null or to_jsonb(m)->>'decision' in ('opted_out','rejected') or m.stage in ('dnc','do_not_contact'))
 ) then reasons:=array_append(reasons,'recipient_suppressed'); end if;$new$;
 if position(new_predicate in definition)>0 then return; end if;
 if position(old_predicate in definition)=0 then raise exception 'Unexpected partnership suppression predicate; inspect before applying'; end if;
 execute replace(definition,old_predicate,new_predicate);
end $migration$;
