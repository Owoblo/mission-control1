import {fs,db} from './gta-email-recovery-runtime.mjs';
import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
const base='https://go.quote2move.com';
function cookie(role){const p=Buffer.from(JSON.stringify({role,name:'John',exp:Date.now()+300000})).toString('base64url');return 'mc_session='+p+'.'+createHmac('sha256',process.env.AUTH_SECRET.replace(/\\n|\\r/g,'').trim()).update(p).digest('base64url');}
if(process.argv[2]!=='deliveries'){
const publicResponse=await fetch(base+'/work-with-us');const html=await publicResponse.text();assert.equal(publicResponse.status,200);assert.match(html,/Your crew\./);assert.match(html,/seven calendar days/);assert.equal((html.match(/<details/g)||[]).length,12);assert.doesNotMatch(html,/Review upcoming due dates daily/);
for(const role of ['owner','operations_lead','sales_rep','partner_admin',null]){
 const r=await fetch(base+'/sales/contractors/playbook',{headers:role?{Cookie:cookie(role)}:{},redirect:'manual'});const text=await r.text();
 if(['owner','operations_lead'].includes(role)){assert.equal(r.status,200);assert.match(text,/Review upcoming due dates daily/);assert.match(text,/October 28/);}else assert.doesNotMatch(text,/Review upcoming due dates daily/);
 console.log(JSON.stringify({role:role||'anonymous',status:r.status,allowed:['owner','operations_lead'].includes(role)}));
}
}
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const checks=[];
for(const f of fs.readdirSync(dir).filter(f=>f.startsWith('email-request-'))){const r=JSON.parse(fs.readFileSync(dir+f));if(!r.sid)continue;let delivery;
 if(r.sid.startsWith('telnyx:')){const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+r.sid.slice(7)});const final=events.find(e=>e.event_type==='message.finalized');delivery=final?.payload?.to?.map(x=>x.status)||['pending'];}
 else{const account=process.env.TWILIO_ACCOUNT_SID.trim();const resp=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${r.sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')}});const body=await resp.json();delivery=[body.status||'unknown'];}
 checks.push({company:r.name,delivery});
}
fs.writeFileSync(dir+(process.argv[2]==='deliveries'?'email-request-deliveries.json':'guide-live-check.json'),JSON.stringify({at:new Date().toISOString(),publicPage:process.argv[2]!=='deliveries',internalRoleChecks:process.argv[2]!=='deliveries',emailRequestDelivery:checks},null,2));console.log(JSON.stringify({publicPage:process.argv[2]!=='deliveries',internalRoleChecks:process.argv[2]!=='deliveries',emailRequestDelivery:checks}));
