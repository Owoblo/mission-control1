import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const overview='https://go.quote2move.com/work-with-us';
const targets=[
 {id:'ed84d5b9-0870-41e4-8f66-c5e1edf228fa',email:'Mailbox@superiormover.ca',greeting:'Hi,',form:false},
 {id:'afb6fc6d-5283-40e8-9b60-9bbd09cdd00f',email:'Adam.jasar@hotmail.com',greeting:'Hi,',form:false},
 {id:'db9e225d-a838-421f-88e7-3466275eaf01',email:'Msmovers2018@gmail.com',greeting:'Hey Jesse,',form:true},
 {id:'b1859baf-0ae3-4250-a149-453ae241ee21',email:'info@7moving.ca',greeting:'Hi,',form:true},
 {id:'0f9795e6-e83e-4de2-957d-ca4642700b28',email:'mightypup.moving.delivery@gmail.com',greeting:'Hi,',form:false},
 {id:'48ce001d-1526-4e20-a18f-0b12fce04244',email:'hubersmoving@gmail.com',greeting:'Hi Nicholas,',form:false},
];
const declined=s=>/^(stop|unsubscribe|cancel|end|quit)\b|not interested|go away|do not (text|contact)|wrong number|i['’]?ll pass/i.test(s.trim());
if(process.argv[2]==='sync'){
 const id='afb9a332-247f-487c-a6c0-b6e64904c128';const [c]=await db('subcontractors',{id:'eq.'+id});const tag='DECLINED CONTRACTOR OUTREACH 2026-10-19';
 if(!c.notes?.includes(tag))await db('subcontractors',{id:'eq.'+id},'PATCH',{status:'paused',notes:(c.notes||'')+'\n\n'+tag+'\nHelping Hands replied "I\'ll pass ty" at 18:41:15Z. Reason not supplied. Exclude from recruiting follow-ups and call list unless they reinitiate. No reply sent.'});
}
if(!['sync','send'].includes(process.argv[2]))throw Error('Use sync/send');
if(process.argv[2]==='send'){
 const r=await fetch(overview);const html=await r.text();if(!r.ok||!html.includes('Your crew.')||!html.includes('seven calendar days'))throw Error('Overview not live');
}
for(const t of targets){
 const [c]=await db('subcontractors',{id:'eq.'+t.id});const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',order:'created_at.asc',limit:1000});
 if(c.status==='blocked'||sms.length===1000||sms.some(s=>s.direction==='inbound'&&declined(s.body)))throw Error('Held '+c.company_name);
 const evidence=sms.find(s=>s.direction==='inbound'&&s.body.toLowerCase().includes(t.email.toLowerCase()));if(!evidence)throw Error('No recipient-supplied email');
 if(c.email&&c.email.toLowerCase()!==t.email.toLowerCase())throw Error('Email conflict');
 if(process.argv[2]==='sync'){
  const tag='RECIPIENT EMAIL CONFIRMED 2026-10-19';await db('subcontractors',{id:'eq.'+t.id},'PATCH',{email:t.email,notes:c.notes?.includes(tag)?c.notes:(c.notes||'')+'\n\n'+tag+'\nRecipient supplied '+t.email+' in inbound SMS '+evidence.id+'. Use for requested contractor information. No job award or dispatch approval.'});console.log(JSON.stringify({company:c.company_name,emailSaved:t.email}));continue;
 }
 const file=dir+'guide-email-'+t.id+'.json';if(fs.existsSync(file)){console.log(JSON.stringify({company:c.company_name,priorReceipt:true}));continue;}
 const peers=await db('market_contacts',{email:'ilike.'+t.email});if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||x.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(x.email_status)))throw Error('Email suppressed');
 const phonePeers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:1000});if(phonePeers.length===1000||phonePeers.some(x=>String(x.phone||'').replace(/\D/g,'').slice(-10)===c.phone.slice(-10)&&(x.do_not_contact||x.cross_channel_suppressed_at)))throw Error('Phone suppressed');
 const events=await db('email_provider_events',{recipient_email:'ilike.'+t.email,limit:1000});if(events.length===1000||events.some(e=>/bounce|complaint|unsubscribe/i.test(e.event_type)))throw Error('Email delivery suppression');
 let form='';if(t.form){const p=JSON.parse(fs.readFileSync(dir+'plan.json')).plans.find(p=>p.id===t.id);const token=p.url.split('/').at(-1);const [i]=await db('partner_onboarding_invites',{token:'eq.'+token});if(i?.subcontractor_id!==t.id||Date.parse(i.expires_at)<Date.now())throw Error('Invite mismatch');form=p.url;}
 let body=t.form?`${t.greeting}\n\nThanks for sending your email. Here is your private subcontractor form:\n${form}\n\nPlease complete your contact, crew, truck, service-area and rate details, and upload your business registration, insurance and ID through the form.\n\nI also put together a short overview covering job offers, flat-rate or hourly work, scope changes, our standards and payment:\n${overview}\n\nWe pay by direct deposit within seven calendar days of job completion, provided we have your invoice and required completion records. If those arrive later, the seven days starts when both are received.\n\nWe have 10 jobs available toward the end of this month. Once your details and documents are reviewed, we can go through suitable jobs and agree the scope and payout before you accept.\n\nJohn, SSM`:`${t.greeting}\n\nThanks for sending your email${t.id.startsWith('48ce')?' and for your interest':''}. Here is the short overview of working with us:\n${overview}\n\nThis is about your team fulfilling suitable Saturn moving jobs as a subcontractor. We handle the customer booking, share the scope, and agree the payout with you before you accept. You choose work that fits your capacity and availability.\n\nThe page covers flat-rate and hourly jobs, documents, scope changes, service standards and our payment terms. We have 10 jobs available toward the end of this month, subject to matching and onboarding.\n\nWhat would be a good time for a quick call about your coverage, crew and trucks? After that, I can send your private onboarding form.\n\nJohn, SSM`;
 if(t.id==='afb6fc6d-5283-40e8-9b60-9bbd09cdd00f')body=body.replace('We have 10 jobs available toward the end of this month, subject to matching and onboarding.', 'I have noted the Northern Ontario coverage you mentioned. We can discuss which routes fit your team; we will confirm suitable work individually.');
 const subject=t.form?'Your subcontractor form and how we work together':'Working together on Saturn moving jobs';
 const receipt={state:'reserved_no_blind_retry',at:new Date().toISOString(),contractorId:t.id,company:c.company_name,to:t.email,subject,body};fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
 const se=parseEnv(fs.readFileSync('.env.ses.local','utf8'));const ses=new SESv2Client({region:se.AWS_REGION,maxAttempts:1,credentials:{accessKeyId:se.AWS_ACCESS_KEY_ID,secretAccessKey:se.AWS_SECRET_ACCESS_KEY}});
 const result=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:[se.PARTNERSHIP_EMAIL_REPLY_TO||'john@saturnstarmovers.ca'],Destination:{ToAddresses:[t.email]},ConfigurationSetName:se.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'campaign',Value:'contractor-guide-20261019'}],Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}}}));if(!result.MessageId)throw Error('Ambiguous send; do not retry');receipt.messageId=result.MessageId;receipt.state='provider_accepted';fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 const id=randomUUID();await db('crm_emails',{},'POST',{id,data:{id,from:'john@saturnstarmovers.ca',to:t.email,subject,body,status:'sent',sentAt:receipt.at,direction:'outbound',subcontractorId:t.id,provider:'ses',providerMessageId:result.MessageId},updated_at:receipt.at,deleted:false});if((await db('crm_emails',{id:'eq.'+id})).length!==1)throw Error('Email log missing');
 const [fresh]=await db('subcontractors',{id:'eq.'+t.id});await db('subcontractors',{id:'eq.'+t.id},'PATCH',{notes:(fresh.notes||'')+'\n\nCONTRACTOR GUIDE EMAILED 2026-10-19\nRequested overview '+(t.form?'and existing private application link':'and call-time request')+' emailed to '+t.email+'. Provider accepted '+result.MessageId+'; CRM log '+id+'. Delivery not yet confirmed. No automatic follow-up.'});receipt.state='accepted_crm_verified';receipt.logId=id;fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({company:c.company_name,to:t.email,state:receipt.state,formIncluded:t.form}));
}
