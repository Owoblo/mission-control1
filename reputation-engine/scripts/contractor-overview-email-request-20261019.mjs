import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const audit=JSON.parse(fs.readFileSync(dir+'audit.json'));
const selected=['1925308a-d457-494c-8323-690b58ad0a79','0d9d6f64-a9a6-4a4e-a86d-e6ccf8866884','ed84d5b9-0870-41e4-8f66-c5e1edf228fa','16c753ec-0b6f-4473-9f32-e11dbe73fa28','18bd9f02-8883-44d5-bc95-196e5c3cb60d','afb9a332-247f-487c-a6c0-b6e64904c128','64b27da2-36e6-48b1-8b85-822fdaf97102','0f9795e6-e83e-4de2-957d-ca4642700b28','afb6fc6d-5283-40e8-9b60-9bbd09cdd00f','c31a589c-1d2d-4150-a590-9a1023033410','e97dcdda-9315-4505-a209-ce288069cc7c'];
const plans=selected.map(id=>{const c=audit.rows.find(x=>x.id===id);return {id,name:c.company_name,phone:c.phone,from:c.sms.filter(s=>s.direction==='outbound').at(-1).from_number};});
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
for(const p of plans){
 const file=dir+'email-request-'+p.id+'.json';
 if(process.argv[2]==='verify'){
  if(!fs.existsSync(file))continue;const receipt=JSON.parse(fs.readFileSync(file));if(!receipt.sid)continue;
  const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+receipt.sid.replace('telnyx:','')});receipt.delivery=events.map(e=>({type:e.event_type,to:e.payload?.to,errors:e.payload?.errors}));fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({name:p.name,delivery:receipt.delivery}));continue;
 }
 if(process.argv[2]!=='send')throw Error('Use send/verify');
 if(fs.existsSync(file)){console.log(JSON.stringify({name:p.name,existingReceipt:true}));continue;}
 const [c]=await db('subcontractors',{id:'eq.'+p.id});if(!c||c.status==='blocked'||c.phone!==p.phone)throw Error('Changed/blocked contact');
 const sms=await db('sms_messages',{or:'(from_number.eq.'+p.phone+',to_number.eq.'+p.phone+')',order:'created_at.asc',limit:1000});
 if(sms.length===1000||sms.some(s=>s.direction==='inbound'&&/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test(s.body.trim())))throw Error('Suppressed');
 const latest=sms.filter(s=>s.direction==='inbound').at(-1);if(c.email||/[^\s@]+@[^\s@]+\.[^\s@]+/.test(latest?.body||'')){console.log(JSON.stringify({name:p.name,skipped:'email already available'}));continue;}
 const peers=await db('market_contacts',{phone:'ilike.*'+p.phone.slice(-4)+'*',limit:1000});if(peers.length===1000||peers.some(x=>String(x.phone||'').replace(/\D/g,'').slice(-10)===p.phone.slice(-10)&&(x.do_not_contact||x.cross_channel_suppressed_at||['opted_out','rejected'].includes(x.decision))))throw Error('Suppressed identity');
 const body="Thanks for getting back to me. What's the best email to send a short overview of how subcontracting with us works? We can go through any questions on a call.\n\nJohn, SSM";
 const receipt={at:new Date().toISOString(),state:'reserved_no_retry',id:p.id,name:p.name,from:p.from,to:p.phone,body};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
 let response,result,sid;
 if(p.from==='+14374650584'){
 response=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from:p.from,to:p.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});
 result=await response.json();sid=result.data?.id?'telnyx:'+result.data.id:null;
 }else{
 const account=process.env.TWILIO_ACCOUNT_SID.trim();response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:p.from,To:p.phone,Body:body}),signal:AbortSignal.timeout(25000)});result=await response.json();sid=result.sid;
 }
 receipt.providerResult=result;receipt.state=response.ok&&sid?'provider_accepted':'failed_or_ambiguous';receipt.sid=sid;fs.writeFileSync(file,JSON.stringify(receipt,null,2));if(!receipt.sid||!response.ok)throw Error('No retry: '+p.name);
 const logId=randomUUID();await db('sms_messages',{},'POST',{id:logId,from_number:p.from,to_number:p.phone,body,direction:'outbound',lead_id:null,twilio_sid:receipt.sid,created_at:receipt.at});if((await db('sms_messages',{twilio_sid:'eq.'+receipt.sid})).length!==1)throw Error('Log mismatch');
 const [fresh]=await db('subcontractors',{id:'eq.'+p.id});await db('subcontractors',{id:'eq.'+p.id},'PATCH',{notes:(fresh.notes||'')+'\n\nEMAIL REQUEST 2026-10-19\nAt owner request, asked responding contractor for preferred email for an overview before a call. Awaiting recipient email. No onboarding approval or job award. SMS '+receipt.sid+'. No automatic resend.'});
 receipt.state='accepted_crm_verified';receipt.logId=logId;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({name:p.name,state:receipt.state,body}));
}
