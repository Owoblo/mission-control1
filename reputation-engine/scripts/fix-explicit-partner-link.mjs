import fs from 'node:fs/promises';
async function sql(query){const r=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});if(!r.ok)throw Error('SQL '+r.status+' '+await r.text());return r.json();}
const [{definition}]=await sql("select pg_get_functiondef('public.link_market_contact_partner_company()'::regprocedure) definition");
if(definition.includes('Preserve explicit account identity on insert')){console.log('Explicit-link fix already installed');process.exit(0);}
if(!definition.includes('\nbegin\n'))throw Error('Unexpected function shape');
const updated=definition.replace('\nbegin\n',"\nbegin\n  -- Preserve explicit account identity on insert; FK validates the referenced account.\n  if TG_OP = 'INSERT' and new.partner_company_id is not null then\n    return new;\n  end if;\n");
const file='supabase/migrations/20260916000400_preserve_explicit_partner_link.sql';
await fs.writeFile(file,'-- Existing unlinked contacts retain automatic resolution. No historical records changed.\n'+updated+';\n');
const tests=`do $$ declare a uuid; c uuid; linked uuid; before_count bigint; begin
insert into partner_companies(company_name,normalized_key) values('Explicit identity fixture',gen_random_uuid()::text) returning id into a;
select count(*) into before_count from partner_companies;
insert into market_contacts(name,company,city,partner_company_id) values('Named branch contact','Different display name','Windsor',a) returning id,partner_company_id into c,linked;
if linked is distinct from a then raise exception 'Explicit organization overwritten'; end if;
if (select count(*) from partner_companies)<>before_count then raise exception 'Duplicate organization generated'; end if;
insert into market_contacts(name,company,city) values('Automatic contact','Autolink fixture '||gen_random_uuid()::text,'Windsor') returning partner_company_id into linked;
if linked is null then raise exception 'Automatic linking regressed'; end if;
end $$;`;
await fs.writeFile('tests/partnership-core/explicit-partner-link.sql',tests+'\n');
await sql('begin;'+updated+';'+tests+'rollback;');console.log('Explicit and automatic linking regressions passed');
await sql('begin;'+updated+';commit;');console.log('Explicit account-link preservation installed');
