import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
const env=parseEnv(fs.readFileSync(new URL('.env.mailivery.local',root),'utf8'));
const apply=process.argv.includes('--apply');
const domains=['moveswithsaturn.com','saturnstarconnect.com','saturnstarmoving.com','saturnstarpartners.com'];
const wanted=domains.flatMap(d=>['john','johnny'].map(n=>`${n}@${d}`));
async function request(path,method='GET',data){const r=await fetch('https://app.mailivery.io/api/v1'+path,{method,headers:{Authorization:'Bearer '+env.MAILIVERY_API_KEY,Accept:'application/json','X-Request-ID':randomUUID(),...(data?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(data?{body:new URLSearchParams(data)}:{}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${j.code||''}`);return j.data??j;}
const payload=await request('/campaigns?per_page=100');const rows=Array.isArray(payload)?payload:payload.data;if(!Array.isArray(rows))throw Error('Unexpected mailbox list');
const limits=await request('/account/limits');
const desired={email_per_day:10,response_rate:30,rampup_speed:'fast'};
const present=rows.filter(r=>wanted.includes(r.email));
const report={checkedAt:new Date().toISOString(),applied:apply,desired,limits,pending:wanted.filter(e=>!present.some(r=>r.email===e)),mailboxes:[]};
const otherAllocation=rows.filter(r=>!wanted.includes(r.email)).reduce((n,r)=>n+Number(r.email_per_day||0),0);
if(apply&&otherAllocation+present.length*desired.email_per_day>limits.email_per_day.total)throw Error('Daily pool insufficient; no settings changed');
for(const r of present){if(apply){await request(`/campaigns/${r.id}/update-email-per-day`,'PATCH',{email_per_day:String(desired.email_per_day)});await request(`/campaigns/${r.id}/update-response-rate`,'PATCH',{response_rate:String(desired.response_rate)});if(r.ramp_up!=='active')await request(`/campaigns/${r.id}/enable-ramp-up`,'PATCH',{rampup_speed:desired.rampup_speed});if(r.status_code==='paused')await request(`/campaigns/${r.id}/resume-warmup`,'PATCH');else if(r.status_code!=='active')await request(`/campaigns/${r.id}/start-warmup`,'PATCH');}report.mailboxes.push({id:r.id,email:r.email,statusBefore:r.status_code,emailPerDay:r.email_per_day,responseRate:r.response_rate,rampUp:r.ramp_up,rampUpSpeed:r.rampup_speed,settingsApplied:apply});}
const dir=new URL('artifacts/google-mail-release-20261109/',root);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(new URL('mailivery-onboarding.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
