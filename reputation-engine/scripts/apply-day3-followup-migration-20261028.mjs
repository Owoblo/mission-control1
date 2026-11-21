import fs from 'node:fs';
import {createHash} from 'node:crypto';
process.loadEnvFile('.env.supabase-admin.local');
const source='supabase/migrations/20261028000100_pilot_day3_followups.sql';
const sql=fs.readFileSync(source,'utf8');
async function query(query){
 const r=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Followup migration query failed ('+r.status+'): '+(await r.text()).slice(0,700));
 return r.json();
}
await query('begin;'+sql+'rollback;');
const apply=process.argv.includes('--apply');
if(apply)await query('begin;'+sql+'commit;');
const verification=apply?await query("select to_regclass('public.pilot_email_followups') as ledger, has_function_privilege('authenticated','public.claim_pilot_day3_followup(uuid,text,jsonb)','execute') as public_claim_allowed, (select count(*) from public.pilot_email_followups) as enrolled;"):null;
const report={at:new Date().toISOString(),source,sha256:createHash('sha256').update(sql).digest('hex'),transactionalDryRunPassed:true,applied:apply,verification,sends:0,automaticWorkerEnabled:false};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/day3-migration-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
