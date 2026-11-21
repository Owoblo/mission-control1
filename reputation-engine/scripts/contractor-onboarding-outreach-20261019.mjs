import {fs,api} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const ids=['961bdc74-9102-41ef-a395-63e43b76a29a','db9e225d-a838-421f-88e7-3466275eaf01','b1859baf-0ae3-4250-a149-453ae241ee21','ae8519a0-dfbf-4e64-90c8-f493216d9f57','772266aa-1c5b-4171-8b39-a68e7ce5f3be'];
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10);
async function note(id,tag,content,patch={}){const [c]=await db('subcontractors',{id:'eq.'+id});if(!c)throw Error('Missing contractor');await db('subcontractors',{id:'eq.'+id},'PATCH',{...patch,notes:c.notes?.includes(tag)?c.notes:(c.notes||'')+'\n\n'+tag+'\n'+content});}
async function preflight(id){
 const [c]=await db('subcontractors',{id:'eq.'+id});if(!ids.includes(id)||!c||c.status==='blocked')throw Error('Excluded contractor');
 const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',order:'created_at.asc',limit:1000});if(sms.length===1000)throw Error('Pagination needed');
 if(sms.some(x=>x.direction==='inbound'&&/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number/i.test(x.body.trim())))throw Error('Declined '+c.company_name);
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:1000});if(peers.length===1000||peers.some(p=>norm(p.phone)===norm(c.phone)&&(p.do_not_contact||p.cross_channel_suppressed_at||['opted_out','rejected'].includes(p.decision))))throw Error('Suppressed');
 return {c,sms};
}
if(process.argv[2]==='prepare'){
 await note('8b47ddb3-ae58-481a-9581-7db6ac73a275','OWNER OUTREACH HOLD 2026-10-19','John confirms Harry has done a job. Hold all onboarding outreach; John wants to message Harry when sending his payment. Payment is not confirmed here. No automated follow-up.',{status:'paused'});
 await note(ids[0],'ONBOARDING EMAIL CONFIRMED 2026-10-19','Email supplied by John at Paradise in inbound SMS; requested details by email again on October 19.',{email:'John@paradisemovers.ca'});
 await note('48ce001d-1526-4e20-a18f-0b12fce04244','CONTACT DETAILS FROM INBOUND SMS 2026-10-19','Nicholas signed his October 16 inbound reply as owner/operator and requested details at hubersmoving@gmail.com. Interested; no substantive phone conversation found in reviewed records.',{contact_name:'Nicholas',email:'hubersmoving@gmail.com'});
 const plans=[];
 for(const [i,id] of ids.entries()){
  const {c,sms}=await preflight(id);
  if(sms.some(x=>x.direction==='outbound'&&/\/onboard\//.test(x.body)))throw Error('Prior link sent: '+c.company_name);
  const {url}=await api('/api/sales/subcontractors/'+id+'/onboarding',{action:'invite'});
  const token=new URL(url).pathname.split('/').at(-1);
  const [invite]=await db('partner_onboarding_invites',{token:'eq.'+token});
  if(invite?.subcontractor_id!==id)throw Error('Invite ownership mismatch');
  const pub=await api('/api/onboarding/'+token);if(!pub.invite?.editable||pub.invite.submitted)throw Error('Already submitted/closed');
  const intro=[
   'Hey John, thanks for following up, and sorry for the delay getting this over. Good speaking with you about your crews and working together.',
   'Hey Jesse, following up on our conversation about working together. We have 10 jobs available toward the end of this month and I’m getting our subcontractor crew details together.',
   'Good speaking with you about your 14-ft and 16-ft trucks and reviewing jobs individually. We have 10 jobs available toward the end of this month and I’d like to see which ones fit your availability.',
   'Good speaking with you about your trucks, trailers and taking on jobs at an agreed flat price. We have 10 jobs available toward the end of this month and I’d like to see which ones are a fit.',
   'Good speaking with you about your 20-ft and 26-ft trucks and the local routes you cover. We have 10 jobs available toward the end of this month and I’d like to see which ones fit your area and availability.'
  ][i];
  const body=i===0?`${intro}\n\nWe have 10 jobs available toward the end of this month. Here’s your subcontractor form so we can record your trucks, crews, service areas, availability, rates and the best direct contact:\n${url}\n\nPlease fill it out and upload your business registration, proof of insurance and ID through the form. It also includes the additional-insured details for MARS RELOCATION SERVICES INC.\n\nFor each suitable job, we’ll send the inventory, route, access details, scope and proposed payout for you to review before accepting. We’ll agree on the rate and payment terms upfront, with invoice details recorded. Any scope changes will come back through us for approval.\n\nOnce I’ve reviewed your form, we can go through the jobs that fit your crews.\n\nJohn, SSM`:`${intro}\n\nPlease fill out your subcontractor form with your contact details, trucks, crew, service areas and rates, and upload your business registration, insurance and ID:\n${url}\n\nWe’ll share the scope and agree on the payout before you accept any job.\n\nJohn, SSM`;
  plans.push({id,name:c.company_name,phone:c.phone,from:i===4?'+12262419853':'+14374650584',channel:i===0?'email':'sms',email:i===0?'John@paradisemovers.ca':undefined,subject:i===0?'Following up — subcontractor details and end-of-month jobs':undefined,body,url,lastSmsId:sms.at(-1)?.id});
  console.log(JSON.stringify({company:c.company_name,channel:plans.at(-1).channel,lastInbound:sms.filter(x=>x.direction==='inbound').at(-1)?.body,linkVerified:true}));
 }
 fs.writeFileSync(dir+'plan.json',JSON.stringify({at:new Date().toISOString(),plans},null,2));
}else if(process.argv[2]==='send'){
 const plan=JSON.parse(fs.readFileSync(dir+'plan.json'));if(Date.now()-Date.parse(plan.at)>3600000)throw Error('Stale plan');
 const se=parseEnv(fs.readFileSync('.env.ses.local','utf8'));
 const telnyx=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
 async function send(p,suffix=''){
  const file=dir+'receipt-'+p.id+suffix+'.json';if(fs.existsSync(file)){console.log(JSON.stringify({name:p.name,existingReceipt:true}));return JSON.parse(fs.readFileSync(file));}
  const {sms}=await preflight(p.id);if(!suffix&&sms.at(-1)?.id!==p.lastSmsId)throw Error('Thread changed '+p.name);
  if(p.channel==='email'){
   const peers=await db('market_contacts',{email:'ilike.'+p.email});if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(x.email_status)))throw Error('Email suppressed');
   const events=await db('email_provider_events',{recipient_email:'ilike.'+p.email,limit:1000});if(events.length===1000||events.some(e=>/bounce|complaint|unsubscribe/i.test(e.event_type)))throw Error('Email delivery suppression');
  }
  const receipt={state:'reserved_no_blind_retry',at:new Date().toISOString(),plan:p};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
  let sid;
  if(p.channel==='email'){
   const ses=new SESv2Client({region:se.AWS_REGION,maxAttempts:1,credentials:{accessKeyId:se.AWS_ACCESS_KEY_ID,secretAccessKey:se.AWS_SECRET_ACCESS_KEY}});
   const result=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:[se.PARTNERSHIP_EMAIL_REPLY_TO||'john@saturnstarmovers.ca'],Destination:{ToAddresses:[p.email]},ConfigurationSetName:se.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'campaign',Value:'contractor-onboarding-20261019'}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}}}}}));sid=result.MessageId;
  }else{
   let r,result;
   if(p.from==='+14374650584'){
    r=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+telnyx,'Content-Type':'application/json'},body:JSON.stringify({from:p.from,to:p.phone,text:p.body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});result=await r.json();sid=result.data?.id?'telnyx:'+result.data.id:null;
   }else{
    const account=process.env.TWILIO_ACCOUNT_SID.trim();r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:p.from,To:p.phone,Body:p.body}),signal:AbortSignal.timeout(25000)});result=await r.json();sid=result.sid;
   }
   receipt.providerResult=result;if(!r.ok){receipt.state='provider_rejected';fs.writeFileSync(file,JSON.stringify(receipt,null,2));throw Error('Provider rejected '+p.name);}
  }
  if(!sid)throw Error('Ambiguous result; no retry');receipt.sid=sid;receipt.state='provider_accepted';fs.writeFileSync(file,JSON.stringify(receipt,null,2));
  const logId=randomUUID();
  if(p.channel==='email'){
   await db('crm_emails',{},'POST',{id:logId,data:{id:logId,from:'john@saturnstarmovers.ca',to:p.email,subject:p.subject,body:p.body,status:'sent',sentAt:receipt.at,direction:'outbound',subcontractorId:p.id,provider:'ses',providerMessageId:sid},updated_at:receipt.at,deleted:false});
   if((await db('crm_emails',{id:'eq.'+logId})).length!==1)throw Error('Email log missing');
  }else{
   await db('sms_messages',{},'POST',{id:logId,from_number:p.from,to_number:p.phone,body:p.body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:receipt.at});if((await db('sms_messages',{twilio_sid:'eq.'+sid})).length!==1)throw Error('SMS log missing');
  }
  await note(p.id,'ONBOARDING INVITE SENT 2026-10-19 '+p.channel+suffix,`Personalized ${p.channel} follow-up sent after positive call; provider accepted ${sid}. CRM log ${logId}. Application linked to this contractor. Documents requested; not approved or activated. No automatic follow-up.`);
  receipt.state='accepted_crm_verified';receipt.logId=logId;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({name:p.name,channel:p.channel,state:receipt.state}));return receipt;
 }
 for(const p of plan.plans){
  const receipt=await send(p);
  if(p.channel==='email'&&receipt.state==='accepted_crm_verified')await send({...p,channel:'sms',body:'Hey John, I’ve just emailed the details and your subcontractor form to John@paradisemovers.ca. Thanks for following up—let me know if it doesn’t come through.\n\nJohn, SSM'},'-email-confirmation');
 }
}else throw Error('Use prepare or send');
