import fs from 'node:fs/promises';import{db}from'./reply-runtime-20261015.mjs';
const dir='artifacts/reply-review-20261019-weekend';
async function all(t,q={}){const a=[];for(let offset=0;;offset+=1000){const p=await db(t,{...q,order:'id.asc',offset:String(offset),limit:'1000'});a.push(...p);if(p.length<1000)return a;}}
const specs={leads:['crm_leads'],emails:['crm_emails'],sms:['sms_messages',{created_at:'gte.2026-10-16T04:00:00Z'}],calls:['call_recordings',{created_at:'gte.2026-10-16T04:00:00Z'}],tasks:['crm_tasks',{status:'in.(open,in_progress)'}]};
const results=await Promise.allSettled(Object.entries(specs).map(async([key,args])=>{const rows=await all(...args);await fs.writeFile(dir+'/'+key+'.json',JSON.stringify(rows));return{key,count:rows.length};}));for(const r of results){if(r.status==='rejected')throw r.reason;console.log(JSON.stringify(r.value));}
