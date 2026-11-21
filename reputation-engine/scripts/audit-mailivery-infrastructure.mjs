import fs from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {classifyBlacklistScan} from './mail-blacklist-classification.mjs';
const root=new URL('../',import.meta.url);
const {MAILIVERY_API_KEY:key}=parseEnv(fs.readFileSync(new URL('.env.mailivery.local',root),'utf8'));
async function request(path,method='GET',body){const r=await fetch('https://app.mailivery.io/api/v1'+path,{method,headers:{Authorization:'Bearer '+key,Accept:'application/json','X-Request-ID':randomUUID(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});const j=await r.json();if(!r.ok)return {error:r.status,code:j.code,message:j.message};return j.data??j;}
const list=await request('/campaigns?per_page=100');const rows=Array.isArray(list)?list:list.data;if(!Array.isArray(rows))throw Error('Invalid mailbox response');
const domains=['moveswithsaturn.com','saturnstarconnect.com','saturnstarmoving.com','saturnstarpartners.com','saturnstarmovers.ca'];
const report={checkedAt:new Date().toISOString(),limits:await request('/account/limits'),blacklists:await request('/blacklists'),placementCredits:await request('/inbox-placement-tests/wallet'),mailboxes:[]};
for(const r of rows.filter(x=>domains.includes(x.email.split('@')[1]))){const results=await Promise.allSettled(['get-health-score','get-health-score-points','fetch-active-schedule','get-metrics'].map(p=>request(`/campaigns/${r.id}/${p}`,'PATCH')));const values=results.map(x=>x.status==='fulfilled'?x.value:{error:String(x.reason)});report.mailboxes.push({email:r.email,status:r.status_code,dailyLimit:r.email_per_day,responseRate:r.response_rate,rampUp:r.ramp_up,spamRateLast14Days:r.spam_rate_in_last_14_days,health:values[0],score:values[1],schedule:values[2],metrics:values[3]});}
if(process.argv.includes('--enable-blacklists')){report.monitorSetup=[];for(const [i,domain] of domains.entries()){const existing=Array.isArray(report.blacklists)?report.blacklists:report.blacklists?.data??[];if(existing.some(x=>x.domain_ip===domain))continue;const result=await request('/blacklists','POST',{monitor_name:`Saturn domain ${i+1}`,domain_ip:domain});report.monitorSetup.push({domain,result});if(result.error)break;}report.blacklists=await request('/blacklists');}
for(const monitor of Array.isArray(report.blacklists)?report.blacklists:[]){
 const details=await request(`/blacklists/${monitor.id}?per_page=1`);
 const scans=Array.isArray(details?.data)?details.data:[];
 const latest=[...scans].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 monitor.classification=classifyBlacklistScan(latest);
}
fs.writeFileSync(new URL('artifacts/google-mail-release-20261109/infrastructure-health.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,mailboxes:report.mailboxes.map(({metrics,...r})=>r)},null,2));
