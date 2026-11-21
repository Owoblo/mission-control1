import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const {db}=await import('./reply-runtime-20261007.mjs');
const root='artifacts/contractor-onboarding-outreach-20261019/';const dir=root+'name-requests/';fs.mkdirSync(dir,{recursive:true});
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
async function note(id,tag,text,patch={}){const [c]=await db('subcontractors',{id:'eq.'+id});await db('subcontractors',{id:'eq.'+id},'PATCH',{...patch,notes:c.notes?.includes(tag)?c.notes:(c.notes||'')+'\n\n'+tag+'\n'+text});}
async function context(id){
 const [c]=await db('subcontractors',{id:'eq.'+id});if(!c||c.status==='blocked'||/IDENTITY REVIEW HOLD|OWNER OUTREACH HOLD|DECLINED CONTRACTOR OUTREACH|AD-CHANNEL PREFERENCE/.test(c.notes||''))throw Error('Held '+id);
 const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',order:'created_at.asc',limit:1000});if(sms.length===1000||sms.some(s=>s.direction==='inbound'&&/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number|i['’]?ll pass|reply thru the ad/i.test(s.body.trim())))throw Error('Declined or different channel');
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:1000});if(peers.length===1000||peers.some(p=>String(p.phone||'').replace(/\D/g,'').slice(-10)===c.phone.slice(-10)&&(p.do_not_contact||p.cross_channel_suppressed_at||['opted_out','rejected'].includes(p.decision))))throw Error('Suppressed');
 return {c,sms,from:sms.filter(s=>s.direction==='outbound').at(-1)?.from_number};
}
async function text(id,body,label){
 const file=dir+label+'-'+id+'.json';if(fs.existsSync(file)){console.log(JSON.stringify({id,label,existing:true}));return;}
 const {c,from}=await context(id);if(label==='name'&&c.contact_name&&!/not yet confirmed|Owner \/ crew manager/i.test(c.contact_name)){console.log(JSON.stringify({company:c.company_name,skip:'name already recorded'}));return;}
 if(!['+14374650584','+12262419853'].includes(from))throw Error('Unexpected sender');
 const receipt={state:'reserved_no_retry',at:new Date().toISOString(),id,company:c.company_name,from,to:c.phone,body,label};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
 let r,j,sid;
 if(from==='+14374650584'){r=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:c.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});j=await r.json();sid=j.data?.id?'telnyx:'+j.data.id:null;}
 else{const account=process.env.TWILIO_ACCOUNT_SID.trim();r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:from,To:c.phone,Body:body}),signal:AbortSignal.timeout(25000)});j=await r.json();sid=j.sid;}
 receipt.result=j;receipt.sid=sid;receipt.state=r.ok&&sid?'accepted':'failed_or_ambiguous';fs.writeFileSync(file,JSON.stringify(receipt,null,2));if(!r.ok||!sid)throw Error('No retry');
 const logId=randomUUID();await db('sms_messages',{},'POST',{id:logId,from_number:from,to_number:c.phone,body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:receipt.at});if((await db('sms_messages',{twilio_sid:'eq.'+sid})).length!==1)throw Error('Missing log');
 await note(id,'CONTRACTOR NAME/REPLY FOLLOW-UP '+label+' 2026-10-19',body+'\nProvider '+sid+'; CRM SMS '+logId+'. Await confirmation; never infer a person’s name from email. Keep company_name and contact_name separate.');receipt.state='accepted_crm_verified';fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({company:c.company_name,label,state:receipt.state}));
}
if(process.argv[2]==='send'){
 throw Error('Superseded: owner requires SES for all outbound contractor email. Use contractor-ses-form-release-20261019.mjs; Zoho is read-only for this workflow.');
 await note('1925308a-d457-494c-8323-690b58ad0a79','AD-CHANNEL PREFERENCE 2026-10-19','Recipient said "Just reply thru the ad you found me in" (SMS 72c82398-b602-4ea0-832d-ff9e6e701c5f). Stop email-address SMS nudges. Original ad conversation must be identified before replying there. No name inferred; no ad reply sent.',{status:'paused'});
 const box=await openZohoMailbox('saturn');
 for(const p of [
  {id:'16c753ec-0b6f-4473-9f32-e11dbe73fa28',email:'Promovers228@gmail.com'},
  {id:'c31a589c-1d2d-4150-a590-9a1023033410',email:'George@deluxemoving.ca'},
  {id:'db9e225d-a838-421f-88e7-3466275eaf01',email:'Msmovers2018@gmail.com',resend:true},
 ]){
  const file=dir+'email-'+p.id+'.json';if(fs.existsSync(file))continue;const {c,sms}=await context(p.id);
  if(!sms.some(s=>s.direction==='inbound'&&s.body.toLowerCase().includes(p.email.toLowerCase())))throw Error('Missing address evidence');
  if(c.email&&c.email.toLowerCase()!==p.email.toLowerCase())throw Error('Email conflict');
  if(p.resend&&!sms.some(s=>s.direction==='inbound'&&s.body==="Didn't receive"))throw Error('No resend reason');
  const peers=await db('market_contacts',{email:'ilike.'+p.email});const events=await db('email_provider_events',{recipient_email:'ilike.'+p.email,limit:1000});if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(x.email_status))||events.length===1000||events.some(x=>/bounce|complaint|unsubscribe/i.test(x.event_type)))throw Error('Email suppressed');
  await note(p.id,'RECIPIENT EMAIL SAVED 2026-10-19 EVENING','Recipient supplied '+p.email+'. Personal name and exact business identity are not inferred from the address.',{email:p.email});
  const subject=p.resend?'Jesse — your Saturn subcontractor form':'How subcontracting with Saturn works';
  let body='Hi,\n\nThanks for sending your email. Here is the overview of how we work with moving crews and independent operators:\nhttps://go.quote2move.com/work-with-us\n\nWe share suitable job scopes and agree the payout before you accept. The page covers flat-rate and hourly work, documents, scope changes, service standards and payment.\n\nWhat would be a good time for a quick call about your coverage, crew and trucks? After that, I can send your private onboarding form.\n\nJohn, SSM';
  if(p.resend){const plan=JSON.parse(fs.readFileSync(root+'plan.json')).plans.find(x=>x.id===p.id);const [invite]=await db('partner_onboarding_invites',{token:'eq.'+plan.url.split('/').at(-1)});if(invite?.subcontractor_id!==p.id||Date.parse(invite.expires_at)<Date.now())throw Error('Invalid link');body='Hey Jesse,\n\nThanks for letting me know. Sending this again from our business mailbox. Here is your private subcontractor form:\n'+plan.url+'\n\nPlease fill out your details and upload your business registration, insurance and ID through the form. Let me know if you have any trouble opening it.\n\nJohn, SSM';}
  const receipt={state:'reserved_no_retry',at:new Date().toISOString(),id:p.id,company:c.company_name,to:p.email,from:box.mailbox,subject,body};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
  const result=await box.request('/accounts/'+box.accountId+'/messages',{fromAddress:box.mailbox,toAddress:p.email,subject,content:body,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'});receipt.result=result;receipt.messageId=result.messageId;receipt.state=result.messageId?'accepted':'ambiguous';fs.writeFileSync(file,JSON.stringify(receipt,null,2));if(!result.messageId)throw Error('Ambiguous send; no retry');
  const logId=randomUUID();await db('crm_emails',{},'POST',{id:logId,data:{id:logId,from:box.mailbox,to:p.email,subject,body,status:'sent',sentAt:receipt.at,direction:'outbound',subcontractorId:p.id,provider:'zoho',providerMessageId:result.messageId},updated_at:receipt.at,deleted:false});if((await db('crm_emails',{id:'eq.'+logId})).length!==1)throw Error('Missing email log');await note(p.id,'BUSINESS MAILBOX FOLLOW-UP 2026-10-19',subject+' sent to '+p.email+' through '+box.mailbox+'. Provider message '+result.messageId+'; CRM log '+logId+'. Acceptance is not proof of inbox delivery.');receipt.state='accepted_crm_verified';receipt.logId=logId;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({company:c.company_name,email:p.email,resend:!!p.resend,state:receipt.state}));
 }
 for(const id of ['16c753ec-0b6f-4473-9f32-e11dbe73fa28','c31a589c-1d2d-4150-a590-9a1023033410'])await text(id,"Thanks, I've emailed the overview. What's your name and the business name you'd like me to save you under?\n\nJohn, SSM",'name');
 for(const id of ['b1859baf-0ae3-4250-a149-453ae241ee21','ed84d5b9-0870-41e4-8f66-c5e1edf228fa','afb6fc6d-5283-40e8-9b60-9bbd09cdd00f','0f9795e6-e83e-4de2-957d-ca4642700b28'])await text(id,"Quick one - what name should I save you under alongside your business name?\n\nJohn, SSM",'name');
 await text('db9e225d-a838-421f-88e7-3466275eaf01',"Hey Jesse, I've resent the form from business@starmovers.ca to Msmovers2018@gmail.com. Please check your inbox and junk folder and let me know if it comes through.\n\nJohn, SSM",'resend-confirmation');
 await note('ae8519a0-dfbf-4e64-90c8-f493216d9f57','RECIPIENT PRICING CORRECTION 2026-10-19','Inbound SMS ead7c949-1470-46a7-a534-a4d694208da7: contractor explicitly does not offer flat rates and asks what rates we are discussing. This supersedes the earlier call-summary interpretation of flat-price interest. Discuss hourly rates; no rate accepted or job awarded.');
 await text('ae8519a0-dfbf-4e64-90c8-f493216d9f57',"Hourly can work too. We'd agree the rate and scope before each job. What hourly rate would work for your truck and crew, and what minimum or travel charges apply? Also, what name should I save you under at Baker?\n\nJohn, SSM",'hourly-and-name');
 await note('afb6fc6d-5283-40e8-9b60-9bbd09cdd00f','RECIPIENT INSURANCE CLAIM 2026-10-19','Recipient says they read the overview and reports 3m contents and 5m CGL (SMS 6e768cc9-6751-4255-8dce-871b5b5ca8f2). Coverage is self-reported, not document-verified. Do not change insured status or eligibility. Name still unconfirmed.');
 await text('afb6fc6d-5283-40e8-9b60-9bbd09cdd00f',"Thanks for reading it. I've noted the $3m contents and $5m CGL coverage; we'll review the insurance documents during onboarding. When's a good time for a quick call about your routes and team?\n\nJohn, SSM",'insurance-call');
 await text('0f9795e6-e83e-4de2-957d-ca4642700b28',"Yes, I emailed the overview to mightypup.moving.delivery@gmail.com with the subject 'Working together on Saturn moving jobs'. Please check your junk folder too and let me know if it hasn't arrived.\n\nJohn, SSM",'email-status');
}else if(process.argv[2]==='verify'){
 const results=[];for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json')&&f!=='verification.json')){const r=JSON.parse(fs.readFileSync(dir+f));if(!r.sid)continue;let status;
  if(r.sid.startsWith('telnyx:')){const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+r.sid.slice(7)});status=events.find(x=>x.event_type==='message.finalized')?.payload?.to?.map(x=>x.status)||['pending'];}
  else{const account=process.env.TWILIO_ACCOUNT_SID.trim();const resp=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${r.sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')}});status=[(await resp.json()).status];}
  results.push({company:r.company,label:r.label,status});
 }fs.writeFileSync(dir+'verification.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
}else throw Error('Use send/verify');
