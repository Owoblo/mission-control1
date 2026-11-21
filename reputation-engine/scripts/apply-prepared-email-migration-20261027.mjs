import fs from 'node:fs';
process.loadEnvFile('.env.supabase-admin.local');
const source='/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/supabase/migrations/20261027000400_prepared_email_dispatch.sql';
const sql=fs.readFileSync(source,'utf8');
async function run(query){
 const r=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Prepared email migration failed ('+r.status+'): '+(await r.text()).slice(0,1000));
 return r.json();
}
await run('begin;'+sql+'rollback;');
await run('begin;'+sql+'commit;');
const result=await run("select to_regclass('public.prepared_email_reviews') as reviews, to_regclass('public.prepared_email_evidence') as evidence, to_regclass('public.prepared_email_dispatches') as dispatches, has_function_privilege('authenticated','public.enqueue_prepared_email(jsonb,timestamp with time zone,uuid)','execute') as public_enqueue_allowed;");
const report={at:new Date().toISOString(),source,applied:true,verification:result,messagesSent:0};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/prepared-email-migration-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
