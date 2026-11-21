import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const plans=JSON.parse(fs.readFileSync(dir+'plan.json')).plans.filter(p=>['db9e225d-a838-421f-88e7-3466275eaf01','b1859baf-0ae3-4250-a149-453ae241ee21','ae8519a0-dfbf-4e64-90c8-f493216d9f57'].includes(p.id));
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
for(const p of plans){
 const file=dir+'email-request-'+p.id+'.json';
 if(process.argv[2]==='verify'){
  if(!fs.existsSync(file))continue;const receipt=JSON.parse(fs.readFileSync(file));if(!receipt.sid)continue;
  const r=await fetch('https://api.telnyx.com/v2/messages/'+receipt.sid.replace('telnyx:',''),{headers:{Authorization:'Bearer '+key}});const data=await r.json();receipt.delivery={http:r.status,to:data.data?.to,errors:data.data?.errors};fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({name:p.name,delivery:receipt.delivery}));continue;
 }
 if(process.argv[2]!=='send')throw Error('Use send/verify');
 if(fs.existsSync(file)){console.log(JSON.stringify({name:p.name,existingReceipt:true}));continue;}
 const [c]=await db('subcontractors',{id:'eq.'+p.id});if(!c||c.status==='blocked'||c.phone!==p.phone)throw Error('Changed/blocked contact');
 const sms=await db('sms_messages',{or:'(from_number.eq.'+p.phone+',to_number.eq.'+p.phone+')',order:'created_at.asc',limit:1000});
 if(sms.length===1000||sms.some(s=>s.direction==='inbound'&&/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test(s.body.trim())))throw Error('Suppressed');
 const latest=sms.filter(s=>s.direction==='inbound').at(-1);if(c.email||/[^\s@]+@[^\s@]+\.[^\s@]+/.test(latest?.body||''))throw Error('Email already available; review '+p.name);
 const peers=await db('market_contacts',{phone:'ilike.*'+p.phone.slice(-4)+'*',limit:1000});if(peers.length===1000||peers.some(x=>String(x.phone||'').replace(/\D/g,'').slice(-10)===p.phone.slice(-10)&&(x.do_not_contact||x.cross_channel_suppressed_at||['opted_out','rejected'].includes(x.decision))))throw Error('Suppressed identity');
 const body=(c.contact_name==='Jesse'?'Hey Jesse,':'Hey,')+" what's the best email to send your subcontractor form to? The text with the link didn't go through.\n\nJohn, SSM";
 const receipt={at:new Date().toISOString(),state:'reserved_no_retry',id:p.id,name:p.name,from:p.from,to:p.phone,body};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
 const response=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from:p.from,to:p.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});
 const result=await response.json();receipt.providerResult=result;receipt.state=response.ok&&result.data?.id?'provider_accepted':'failed_or_ambiguous';receipt.sid=result.data?.id?'telnyx:'+result.data.id:null;fs.writeFileSync(file,JSON.stringify(receipt,null,2));if(!receipt.sid||!response.ok)throw Error('No retry: '+p.name);
 const logId=randomUUID();await db('sms_messages',{},'POST',{id:logId,from_number:p.from,to_number:p.phone,body,direction:'outbound',lead_id:null,twilio_sid:receipt.sid,created_at:receipt.at});if((await db('sms_messages',{twilio_sid:'eq.'+receipt.sid})).length!==1)throw Error('Log mismatch');
 const [fresh]=await db('subcontractors',{id:'eq.'+p.id});await db('subcontractors',{id:'eq.'+p.id},'PATCH',{notes:(fresh.notes||'')+'\n\nEMAIL REQUEST 2026-10-19\nAt owner request, asked for preferred email after onboarding SMS delivery failed. Awaiting recipient email to send existing private form link. SMS '+receipt.sid+'. No automatic resend.'});
 receipt.state='accepted_crm_verified';receipt.logId=logId;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({name:p.name,state:receipt.state,body}));
}
