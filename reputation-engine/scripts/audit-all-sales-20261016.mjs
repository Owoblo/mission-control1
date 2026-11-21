import './gta-email-recovery-runtime.mjs';import fs from 'node:fs/promises';const{db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/all-sales-audit-20261016/';await fs.mkdir(dir,{recursive:true});
async function all(t,q={}){let a=[];for(let offset=0;;offset+=1000){const p=await db(t,{order:'id.asc',...q,limit:'1000',offset:String(offset)});a.push(...p);if(p.length<1000)return a;}}
const specs={leads:['crm_leads'],sms:['sms_messages'],followups:['crm_followup_logs'],tasks:['crm_tasks'],jobs:['crm_automation_jobs',{status:'in.(pending,running,failed)',order:'created_at.asc'}],threads:['crm_conversation_threads']};
for(let i=0;i<Object.keys(specs).length;i+=3){const r=await Promise.allSettled(Object.entries(specs).slice(i,i+3).map(async([k,args])=>{const a=await all(...args);await fs.writeFile(dir+k+'.json',JSON.stringify(a));console.log(k,a.length)}));for(const x of r)if(x.status==='rejected')console.log('READ ERROR',x.reason.message);}
for(const k of ['calls','emails','quotes','contacts','touches'])await fs.copyFile('artifacts/partner-sales-audit-20261016/'+k+'.json',dir+k+'.json');
await fs.writeFile(dir+'meta.json',JSON.stringify({at:new Date().toISOString(),scope:'All Sales leads; full stored SMS and follow-up logs; call recordings since September 16 plus embedded callLogs; quotes/emails from immediately preceding audit'}));
