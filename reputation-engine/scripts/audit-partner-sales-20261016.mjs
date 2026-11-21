import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/partner-sales-audit-20261016';await fs.mkdir(dir,{recursive:true});
const since='2026-09-16T04:00:00Z';
async function all(t,q={}){let out=[];for(let offset=0;;offset+=1000){const rows=await db(t,{order:'id.asc',...q,limit:'1000',offset:String(offset)});out.push(...rows);if(rows.length<1000)return out;}}
const specs={leads:['crm_leads'],contacts:['market_contacts',{select:'id,name,phone,email,city,category,stage,created_at,partner_company_id'}],touches:['market_touches',{created_at:'gte.'+since}],sms:['sms_messages',{created_at:'gte.'+since}],calls:['call_recordings',{created_at:'gte.'+since,order:'recording_sid.asc'}],referrals:['partner_referrals'],tasks:['crm_tasks']};
for(let i=0;i<Object.keys(specs).length;i+=3){const r=await Promise.allSettled(Object.entries(specs).slice(i,i+3).map(async([k,args])=>{const rows=await all(...args);await fs.writeFile(dir+'/'+k+'.json',JSON.stringify(rows));console.log(k,rows.length)}));for(const x of r)if(x.status==='rejected')throw x.reason;}
await fs.writeFile(dir+'/meta.json',JSON.stringify({since,at:new Date().toISOString()}));
