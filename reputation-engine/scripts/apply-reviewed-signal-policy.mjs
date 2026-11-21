import fs from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN;
if(!token)throw Error('SUPABASE_ACCESS_TOKEN is required for the database management API; service-role credentials do not authorize migrations');
const project=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const migration=await fs.readFile('supabase/migrations/20260919000300_reviewed_signal_task_context.sql','utf8');
const tests=await fs.readFile('tests/partnership-core/reviewed-signal.sql','utf8');
async function run(query){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Signal policy migration/probe failed: '+r.status+' '+await r.text());
 return r.json();
}
await run('begin;\n'+migration+'\n'+tests+'\nrollback;');
console.log('Transactional signal-policy regression passed and rolled back');
if(process.argv.includes('--apply')){
 await run('begin;\n'+migration+'\ncommit;');
 console.log('Reviewed signal task policy installed');
}
