import {fs,api,db as read} from './gta-email-recovery-runtime.mjs';import {createRequire} from 'node:module';import {createHash,randomUUID} from 'node:crypto';
const root='/Users/owoblo/Downloads/mission-control1/reputation-engine/',dir=root+'artifacts/gta-email-recovery-20261009';const require=createRequire(root+'package.json');
const {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand,GetAccountCommand}=require('@aws-sdk/client-sesv2');
const {db,base,headers}=await import(root+'scripts/reply-runtime-20261007.mjs');const {reserveAction}=await import(root+'lib/partnership-core/reserve.mjs');const {openZohoMailbox}=await import(root+'lib/partnership-core/zoho.mjs');
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});const mailbox=await openZohoMailbox();
if(!process.env.AWS_SES_CONFIGURATION_SET?.trim())throw Error('Missing delivery event configuration');
const health=await ses.send(new GetAccountCommand({}));if(!health.SendingEnabled||!health.ProductionAccessEnabled||health.EnforcementStatus!=='HEALTHY')throw Error('SES unhealthy');
const checked=JSON.parse(fs.readFileSync(dir+'/validation-results.json')),ready=checked.filter(x=>x.status==='ready');const snapshot=JSON.parse(fs.readFileSync(dir+'/snapshot.json'));const contacts=new Map(snapshot.contacts.map(c=>[c.id,c]));
fs.mkdirSync(dir+'/receipts',{recursive:true});const sender='John | Saturn Star Movers <john@saturnstarmovers.ca>';const campaign='gta-email-recovery-20261009';
const emailIn=s=>String(s||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[];let recentMail=new Set();
async function refreshMail(){const rows=await mailbox.request(`/accounts/${mailbox.accountId}/messages/view?start=1&limit=200&includeto=true&threadedMails=false`);if(!Array.isArray(rows)||rows.length===200&&Number(rows.at(-1).receivedTime)>Date.parse(JSON.parse(fs.readFileSync(dir+'/mailbox-snapshot.json')).at))throw Error('New mailbox window incomplete');recentMail=new Set(rows.flatMap(m=>[m.fromAddress,m.toAddress,m.ccAddress].flatMap(emailIn)));}
const allPlans=JSON.parse(fs.readFileSync(dir+'/send-plan.json'));
const rangeArg=process.argv.find(x=>x.startsWith('--range='));
const range=rangeArg?rangeArg.slice(8).split(':').map(Number):null;
if(range&&(!range.every(Number.isInteger)||range[0]<0||range[1]>468||range[0]>=range[1]))throw Error('Invalid worker range');
const onlyArg=process.argv.find(x=>x.startsWith('--only='));
const only=onlyArg?onlyArg.slice(7).split(','):null;
if(only&&(range||only.some(id=>!allPlans.some(p=>p.id===id))))throw Error('Invalid retry selection');
const plans=only?allPlans.filter(p=>only.includes(p.id)):range?allPlans.slice(...range):allPlans;
const resultsFile=dir+(only?'/send-results-reconciled-retry.json':range?'/send-results-'+range.join('-')+'.json':'/send-results.json');
if(allPlans.length!==468||new Set(allPlans.map(p=>p.email)).size!==allPlans.length)throw Error('Invalid saved plan');
for(const p of plans)if(createHash('sha256').update(p.subject+'\n'+p.body).digest('hex')!==p.content_hash)throw Error('Saved content mismatch');
let priorAccepted=0;
for(const file of fs.readdirSync(dir+'/receipts')){
 const receipt=JSON.parse(fs.readFileSync(dir+'/receipts/'+file));
 if(!plans.some(p=>p.id===receipt.id))continue;
 if(receipt.state==='held')continue;
 if(receipt.state!=='accepted')throw Error('Existing receipt requires review: '+receipt.id);
 const [touch]=await read('market_touches',{id:'eq.'+receipt.touchId});
 const [contact]=await read('market_contacts',{id:'eq.'+receipt.id});
 if(touch?.metadata?.provider_message_id!==receipt.messageId||contact?.email_provider_message_id!==receipt.messageId)throw Error('Prior receipt mismatch: '+receipt.id);
 priorAccepted++;
}
await refreshMail();
console.log(JSON.stringify({reconciled:priorAccepted,remaining:plans.length-priorAccepted,mailboxChecked:true}));
if(!process.argv.includes('--send')){console.log(JSON.stringify({prepared:plans.length,queued:0,sent:0}));process.exit(0)}
if(mailbox.mailbox!=='business@starmovers.ca')throw Error('Reply mailbox unavailable');
async function saveReview(event){
 const [prior]=await read('partnership_policy_events',{event_key:'eq.'+event.event_key});
 if(prior){if(prior.evidence?.content_hash!==event.evidence.content_hash||prior.evidence?.recipient!==event.evidence.recipient)throw Error('Existing review mismatch');
 if(Date.parse(prior.evidence.expires_at)<=Date.now()+60000)throw Error('Existing review expired; renewed review required');
 // Policy evidence is append-only. Reuse the same still-valid reviewed content; never edit it.
 }else await db('partnership_policy_events',{},'POST',event);
}
let accepted=priorAccepted,held=fs.readdirSync(dir+'/receipts').map(f=>JSON.parse(fs.readFileSync(dir+'/receipts/'+f))).filter(r=>r.state==='held'&&plans.some(p=>p.id===r.id)).length;const results=[];
for(const [index,p]of plans.entries()){
 const path=dir+'/receipts/'+p.id+'.json';if(fs.existsSync(path)){results.push(JSON.parse(fs.readFileSync(path)));continue;}let reserved=false;
 try{
 if(index===priorAccepted||index%10===0){await refreshMail();const events=await read('email_provider_events',{event_type:'in.(bounce,complaint)',created_at:'gte.'+new Date(Date.now()-3600000).toISOString(),limit:'1000'});if(events.some(e=>allPlans.some(p=>p.email===String(e.recipient_email).toLowerCase())&&e.event_type==='complaint'))throw Error('CAMPAIGN_STOP_complaint');if(accepted>=50&&events.filter(e=>allPlans.some(p=>p.email===String(e.recipient_email).toLowerCase())).length/accepted>.03)throw Error('CAMPAIGN_STOP_delivery_health');}
 if(recentMail.has(p.email))throw Error('new_mailbox_correspondence');
 const settled=await Promise.allSettled([read('market_contacts',{id:'eq.'+p.id}),api('/api/marketing/contacts/'+p.id+'/context'),read('market_contacts',{email:'ilike.'+p.email}),read('email_provider_events',{recipient_email:'ilike.'+p.email,limit:'1'})]);for(const r of settled)if(r.status==='rejected')throw r.reason;
 const [[c],context,peers,priorEvents]=settled.map(r=>r.value);
 if(!c||!context.complete||context.ambiguousPhone||context.jobs?.length||context.events.some(e=>e.direction==='inbound'||e.channel==='email'||e.channel==='phone'||e.source!=='Partnerships'))throw Error('changed_shared_context');
 if(c.last_inbound_at||c.email_last_replied_at||c.email_last_sent_at||c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||['opted_out','rejected'].includes(c.decision)||['dnc','closed_lost','do_not_contact'].includes(c.stage))throw Error('suppressed_or_changed_contact');
 if((c.email&&c.email.toLowerCase()!==p.email)||peers.some(x=>x.id!==c.id)||priorEvents.length)throw Error('email_route_or_history_changed');
 if(c.phone!==p.phone||c.city!==p.city||c.partner_company_id!==p.account_id||!context.events.some(e=>e.sourceId===p.first_sms_touch_id))throw Error('identity_or_sms_evidence_changed');
 try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.email}));throw Error('ses_suppressed')}catch(e){if(e.name!=='NotFoundException')throw e;}
 const existingReservations=await read('partnership_action_reservations',{action_key:'eq.'+p.key});if(existingReservations.length)throw Error('existing_reservation_requires_reconciliation');
 const at=new Date().toISOString();
 await db('market_contacts',{id:'eq.'+p.id,email:c.email?'eq.'+c.email:'is.null'},'PATCH',{email:p.email,email_source:'realtor_ca_import_owner_reviewed',email_verification_status:'valid',email_verification_provider:'aws_ses',email_verification_reason:'Overall HIGH; syntax/DNS HIGH; mailbox '+p.mailbox_existence+'; disposable/random/role LOW. No delivery guarantee.',email_verification_checked_at:p.checked_at,email_verified_at:at});
 await saveReview({event_key:'nonresponse-review:'+p.key,account_id:p.account_id,action_key:p.key,event_type:'nonresponse_email.reviewed',evidence:{contact_id:p.id,recipient:p.email,sender,content_hash:p.content_hash,owner_authorized:true,context_complete:true,mailbox_checked:true,email_validation_status:'overall_valid_nonrisky',mailbox_existence:p.mailbox_existence,reviewed_by:'John — explicitly authorized GTA nonresponder email follow-up',source_url:p.source_url,source_sms_touch_id:p.first_sms_touch_id,expires_at:new Date(Date.now()+30*60000).toISOString()}});
 for(let attempt=0;;attempt++){
  try{await reserveAction({url:base,headers,contactId:p.id,channel:'email',kind:'cold_introduction',key:p.key,content:p.subject+'\n'+p.body,sender,emailProvider:'ses'});break;}
  catch(error){if(error.message!=='Policy reservation unavailable (500)'||attempt>=2)throw error;
   const existing=await read('partnership_action_reservations',{action_key:'eq.'+p.key});
   if(existing.length)throw Error('existing_reservation_requires_reconciliation');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }
 const touchId=randomUUID(),metadata={source:campaign,provider:'ses',delivery_state:'reserved',from:sender,to:p.email,subject:p.subject,reply_to:'business@starmovers.ca',campaign_key:campaign,source_sms_touch_id:p.first_sms_touch_id,owner_review_action_key:p.key};
 fs.writeFileSync(path,JSON.stringify({id:p.id,email:p.email,state:'reserved_do_not_retry',touchId,at}),{flag:'wx'});reserved=true;
 await db('market_touches',{},'POST',{id:touchId,contact_id:p.id,channel:'email',direction:'outbound',notes:'Subject: '+p.subject+'\n\n'+p.body,created_by:'John',metadata});
 const sent=await ses.send(new SendEmailCommand({FromEmailAddress:sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[p.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:p.id},{Name:'campaign',Value:campaign}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}},Headers:[{Name:'List-Unsubscribe',Value:'<'+p.unsubscribe_url+'>'}]}}}));
 if(!sent.MessageId)throw Error('Ambiguous provider acceptance');const result={id:p.id,email:p.email,state:'accepted',messageId:sent.MessageId,touchId,at:new Date().toISOString()};fs.writeFileSync(path,JSON.stringify(result,null,2));
 await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:sent.MessageId}});
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{last_touch_at:result.at,email_last_sent_at:result.at,email_provider:'ses',email_provider_message_id:sent.MessageId,email_campaign_name:campaign,sequence_paused:true,sequence_paused_reason:'owner_reviewed_email_followup_await_response',next_follow_up:null});
 const [logged]=await read('market_touches',{id:'eq.'+touchId});if(logged.metadata?.provider_message_id!==sent.MessageId)throw Error('CRM receipt mismatch');accepted++;results.push(result);
 }catch(e){const result={id:p.id,email:p.email,state:reserved?'reserved_or_accepted_needs_reconciliation':'held',reason:e.message};results.push(result);held++;if(!reserved)fs.writeFileSync(path,JSON.stringify(result,null,2));if(reserved||e.message.startsWith('CAMPAIGN_STOP')||!['new_mailbox_correspondence','changed_shared_context','suppressed_or_changed_contact','email_route_or_history_changed','identity_or_sms_evidence_changed','ses_suppressed','existing_reservation_requires_reconciliation','Policy reservation unavailable (500)'].includes(e.message)){fs.writeFileSync(resultsFile,JSON.stringify(results,null,2));throw e;}}
 if((index+1)%10===0)console.log(JSON.stringify({processed:index+1,total:plans.length,accepted,held}));
 fs.writeFileSync(resultsFile,JSON.stringify(results,null,2));await new Promise(r=>setTimeout(r,350));
}
console.log(JSON.stringify({finished:true,total:plans.length,accepted,held}));
