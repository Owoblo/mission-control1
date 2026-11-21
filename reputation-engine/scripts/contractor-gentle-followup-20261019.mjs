import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const root='artifacts/contractor-onboarding-outreach-20261019/';
const dir=root+'gentle-followup/';fs.mkdirSync(dir,{recursive:true});
const audit=JSON.parse(fs.readFileSync(root+'audit.json'));
const formIds=['961bdc74-9102-41ef-a395-63e43b76a29a','db9e225d-a838-421f-88e7-3466275eaf01','b1859baf-0ae3-4250-a149-453ae241ee21','772266aa-1c5b-4171-8b39-a68e7ce5f3be'];
const emailIds=['ae8519a0-dfbf-4e64-90c8-f493216d9f57','1925308a-d457-494c-8323-690b58ad0a79','0d9d6f64-a9a6-4a4e-a86d-e6ccf8866884','16c753ec-0b6f-4473-9f32-e11dbe73fa28','18bd9f02-8883-44d5-bc95-196e5c3cb60d','64b27da2-36e6-48b1-8b85-822fdaf97102','c31a589c-1d2d-4150-a590-9a1023033410','e97dcdda-9315-4505-a209-ce288069cc7c'];
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10);
async function preflight(id){
 const [c]=await db('subcontractors',{id:'eq.'+id});const previous=audit.rows.find(x=>x.id===id);if(!c||!previous||c.phone!==previous.phone||c.status==='blocked'||/IDENTITY REVIEW HOLD|OWNER OUTREACH HOLD|DECLINED CONTRACTOR OUTREACH/.test(c.notes||''))throw Error('Held '+id);
 const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',order:'created_at.asc',limit:1000});
 if(sms.length===1000||sms.some(s=>s.direction==='inbound'&&/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number|i['’]?ll pass|too busy to be able to assist/i.test(s.body.trim())))throw Error('Declined '+c.company_name);
 if(sms.at(-1)?.id!==previous.sms.at(-1)?.id)throw Error('New activity requires review: '+c.company_name);
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:1000});if(peers.length===1000||peers.some(p=>norm(p.phone)===norm(c.phone)&&(p.do_not_contact||p.cross_channel_suppressed_at||['opted_out','rejected'].includes(p.decision))))throw Error('Suppressed');
 const invites=await db('partner_onboarding_invites',{subcontractor_id:'eq.'+id,order:'created_at.desc',limit:20});if(invites.length===20)throw Error('Invite pagination needed');if(invites.some(i=>i.checklist?.application||['agreement','approved','active'].includes(i.stage)))return {skip:'application already submitted',c};
 if(formIds.includes(id)&&!invites.length)return {skip:'no invite',c};
 if(emailIds.includes(id)&&(c.email||sms.some(s=>s.direction==='inbound'&&/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s.body))))return {skip:'email already supplied',c};
 const from=sms.filter(s=>s.direction==='outbound').at(-1)?.from_number;if(!['+14374650584','+12262419853','+15486391428'].includes(from))throw Error('Unexpected sender');
 return {c,from,kind:formIds.includes(id)?'form':'email'};
}
if(process.argv[2]==='send'){
 if(Date.now()-Date.parse(audit.at)>3600000)throw Error('Stale review');
 for(const id of [...formIds,...emailIds]){
  const file=dir+'receipt-'+id+'.json';if(fs.existsSync(file)){console.log(JSON.stringify({id,existingReceipt:true}));continue;}
  const p=await preflight(id);if(p.skip){console.log(JSON.stringify({company:p.c.company_name,skip:p.skip}));continue;}
  const greeting=p.c.contact_name==='Jesse'?'Hey Jesse,':p.c.contact_name==='John'?'Hey John,':'Hey,';
  const sentBy=p.c.id==='772266aa-1c5b-4171-8b39-a68e7ce5f3be'?'sent over':'emailed';
  const body=p.kind==='form'?`${greeting} just following up on the subcontractor form I ${sentBy}. When you have a moment, please complete it and upload your documents. Let me know if it didn't reach you or you have any questions.\n\nJohn, SSM`:`${greeting} just a gentle follow-up - what's the best email to send ${id==='ae8519a0-dfbf-4e64-90c8-f493216d9f57'?'your subcontractor form':'the overview of working together'} to? Happy to answer any questions too.\n\nJohn, SSM`;
  const receipt={state:'reserved_no_blind_retry',at:new Date().toISOString(),id,name:p.c.company_name,phone:p.c.phone,from:p.from,kind:p.kind,body};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
  let response,result,sid;
  if(p.from==='+14374650584'){
   response=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from:p.from,to:p.c.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});result=await response.json();sid=result.data?.id?'telnyx:'+result.data.id:null;
  }else{
   const account=process.env.TWILIO_ACCOUNT_SID.trim();response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:p.from,To:p.c.phone,Body:body}),signal:AbortSignal.timeout(25000)});result=await response.json();sid=result.sid;
  }
  receipt.providerResult=result;receipt.sid=sid;receipt.state=response.ok&&sid?'provider_accepted':'failed_or_ambiguous';fs.writeFileSync(file,JSON.stringify(receipt,null,2));if(!response.ok||!sid)throw Error('Provider failure; do not retry');
  const logId=randomUUID();await db('sms_messages',{},'POST',{id:logId,from_number:p.from,to_number:p.c.phone,body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:receipt.at});if((await db('sms_messages',{twilio_sid:'eq.'+sid})).length!==1)throw Error('Log missing');
  const [fresh]=await db('subcontractors',{id:'eq.'+id});await db('subcontractors',{id:'eq.'+id},'PATCH',{notes:(fresh.notes||'')+'\n\nOWNER-REQUESTED GENTLE FOLLOW-UP '+receipt.at+'\n'+(p.kind==='form'?'Application still unsubmitted; reminded to complete form and upload documents.':'Preferred email still missing; gently requested it again.')+' Provider accepted '+sid+'. CRM SMS '+logId+'. No automatic further follow-up.'});
  receipt.state='accepted_crm_verified';receipt.logId=logId;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({company:p.c.company_name,kind:p.kind,state:receipt.state}));
 }
}else if(process.argv[2]==='verify'){
 const results=[];
 for(const file of fs.readdirSync(dir).filter(f=>f.startsWith('receipt-'))){const r=JSON.parse(fs.readFileSync(dir+file));if(!r.sid)continue;let statuses,errors;
  if(r.sid.startsWith('telnyx:')){const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+r.sid.slice(7)});const final=events.find(e=>e.event_type==='message.finalized');if(final){statuses=final.payload?.to?.map(t=>t.status);errors=final.payload?.errors;}else{const res=await fetch('https://api.telnyx.com/v2/messages/'+r.sid.slice(7),{headers:{Authorization:'Bearer '+key}});const data=await res.json();statuses=data.data?.to?.map(t=>t.status)||['pending'];errors=data.data?.errors;}}
  else{const account=process.env.TWILIO_ACCOUNT_SID.trim();const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${r.sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')}});const data=await res.json();statuses=[data.status||'unknown'];errors=data.error_code;}
  results.push({company:r.name,kind:r.kind,statuses,errors});
 }
 fs.writeFileSync(dir+'delivery-status.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
}else throw Error('Use send/verify');
