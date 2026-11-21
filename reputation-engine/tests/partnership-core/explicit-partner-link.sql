do $$ declare a uuid; c uuid; linked uuid; before_count bigint; begin
insert into partner_companies(company_name,normalized_key) values('Explicit identity fixture',gen_random_uuid()::text) returning id into a;
select count(*) into before_count from partner_companies;
insert into market_contacts(name,company,city,partner_company_id) values('Named branch contact','Different display name','Windsor',a) returning id,partner_company_id into c,linked;
if linked is distinct from a then raise exception 'Explicit organization overwritten'; end if;
if (select count(*) from partner_companies)<>before_count then raise exception 'Duplicate organization generated'; end if;
insert into market_contacts(name,company,city) values('Automatic contact','Autolink fixture '||gen_random_uuid()::text,'Windsor') returning partner_company_id into linked;
if linked is null then raise exception 'Automatic linking regressed'; end if;
end $$;
