import {fs,api,db as read} from './gta-email-recovery-runtime.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand,GetAccountCommand} from '@aws-sdk/client-sesv2';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {activeLocations} from '../lib/partnership-core/markets.mjs';
const {db,base,headers}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/other-region-email-audit-20261010',campaign='regional-email-recovery-20261010';
const snapshot=JSON.parse(fs.readFileSync(dir+'/snapshot.json'));
const validation=JSON.parse(fs.readFileSync(dir+'/validation-results.json'));
if(validation.length!==57)throw Error('Validation incomplete');
const contacts=new Map(snapshot.contacts.map(c=>[c.id,c]));
const touches=new Map(snapshot.touches.map(t=>[t.id,t]));
const plans=validation.filter(v=>v.status==='ready').map(p=>{
 const c=contacts.get(p.id),ottawa=p.region==='Ottawa',brand=ottawa?'Dexa Movers':'Saturn Star Movers',name=ottawa?'Dr. Courage':'John';
 const sender=ottawa?'Dr. Courage | Dexa Movers <hello@dexamovers.ca>':'John | Saturn Star Movers <john@saturnstarmovers.ca>';
 const replyTo=ottawa?'hello@dexamovers.ca':'business@starmovers.ca';
 const prior=touches.get(p.first_sms_touch_id);const greeting=prior.notes?.match(/^Hi ([^,\n]{1,45}),/i)?.[1];
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',month:'long',day:'numeric'}).format(new Date(p.first_sms_at));
 const phone=ottawa?'613-519-3236':p.region.startsWith('Windsor')?'226-887-0667':p.region.startsWith('Kitchener')?'226-241-9853':'548-639-1428';
 const role=/mortgage/.test(p.category||'')?'For clients approaching a home purchase or closing, it can help to have a moving contact ready.':'We help with residential moves and can review the details when a client needs moving support.';
 const subject=`Moving support for your ${p.city} clients`;
 const body=`${greeting?'Hi '+greeting+',':'Hello,'}\n\nI sent you a brief text on ${date} about moving support for your clients in ${p.city}. I thought I would put the details here too, so they are easy to save and forward.\n\n${role} If you already have a mover you trust, we would be happy to be a backup when they are unavailable.\n\n${ottawa?'We review the move date, locations, contents and access before providing an estimate and confirming availability.':'We provide a flat binding estimate after reviewing the items, route and access, so the price for the agreed scope is clear upfront.'}\n\nWould a digital card you can forward to clients be useful?\n\n${name}\n${brand}\n${phone}\n${replyTo}\nhttps://${ottawa?'dexamovers.ca':'starmovers.ca'}\n${ottawa?'Ottawa and surrounding areas':'Mailing address: 3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4'}\n\nIf you prefer no further outreach, reply with 'unsubscribe me' and we will remove you from future partnership outreach.`;
 return {...p,ottawa,sender,replyTo,subject,body,key:'owner-email-recovery-regions-20261010:'+p.id,source_url:[p.source_url,c.website].find(s=>s?.startsWith('https://'))||'https://go.quote2move.com/marketing/partners?contact='+p.id,content_hash:createHash('sha256').update(subject+'\n'+body).digest('hex')};
});
if(new Set(plans.map(p=>p.email)).size!==plans.length)throw Error('Duplicate email');
fs.writeFileSync(dir+'/send-plan.json',JSON.stringify(plans,null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify({prepared:plans.length,regions:plans.reduce((a,p)=>(a[p.region]=(a[p.region]||0)+1,a),{})}));process.exit(0);}
const saturn=await openZohoMailbox(),ottawa=await openZohoMailbox('ottawa');
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const health=await ses.send(new GetAccountCommand({}));if(!health.SendingEnabled||!health.ProductionAccessEnabled||health.EnforcementStatus!=='HEALTHY'||!process.env.AWS_SES_CONFIGURATION_SET)throw Error('SES not ready');
const emailPattern=/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
let recent=new Set();
async function refresh(){recent=new Set();for(const [market,m]of [['saturn',saturn],['ottawa',ottawa]]){
 const cutoff=Date.parse(JSON.parse(fs.readFileSync(dir+'/mailbox-'+market+'.json')).at);
 const rows=await m.request(`/accounts/${m.accountId}/messages/view?start=1&limit=200&includeto=true&threadedMails=false`);
 if(!Array.isArray(rows)||(rows.length===200&&Number(rows.at(-1).receivedTime)>cutoff))throw Error('Incremental mailbox check incomplete');
 for(const row of rows)for(const s of [row.fromAddress,row.toAddress,row.ccAddress])for(const email of String(s||'').match(emailPattern)||[])recent.add(email.toLowerCase());
}}
fs.mkdirSync(dir+'/receipts',{recursive:true});let accepted=0,held=0;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
for(const [index,p]of plans.entries()){
 const file=dir+'/receipts/'+p.id+'.json';if(fs.existsSync(file))continue;let reserved=false;
 try{
 if(index%5===0)await refresh();if(recent.has(p.email))throw Error('new_mailbox_correspondence');
 const settled=await Promise.allSettled([read('market_contacts',{id:'eq.'+p.id}),api('/api/marketing/contacts/'+p.id+'/context'),read('market_contacts',{email:'ilike.'+p.email}),read('email_provider_events',{recipient_email:'ilike.'+p.email,limit:'1'})]);for(const r of settled)if(r.status==='rejected')throw r.reason;
 const [[c],context,peers,events]=settled.map(r=>r.value);
 if(!c||!context.complete||context.ambiguousPhone||context.jobs?.length||context.events.some(e=>e.direction==='inbound'||e.channel==='email'||e.channel==='phone'||e.source!=='Partnerships'))throw Error('changed_shared_context');
 if(c.last_inbound_at||c.email_last_replied_at||c.email_last_sent_at||c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||['opted_out','rejected'].includes(c.decision)||['dnc','closed_lost','do_not_contact'].includes(c.stage))throw Error('suppressed_or_changed_contact');
 if((c.email&&c.email.toLowerCase()!==p.email)||peers.some(x=>x.id!==p.id)||events.length)throw Error('email_route_or_history_changed');
 if(c.phone!==p.phone||c.city!==p.city||c.partner_company_id!==p.account_id||!context.events.some(e=>e.sourceId===p.first_sms_touch_id))throw Error('identity_or_sms_evidence_changed');
 if((await read('partnership_action_reservations',{contact_id:'eq.'+p.id,channel:'eq.email'})).length)throw Error('existing_email_reservation');
 try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.email}));throw Error('ses_suppressed');}catch(e){if(e.name!=='NotFoundException')throw e;}
 const at=new Date().toISOString();
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{email:p.email,email_source:c.email_source||'owner_reviewed_existing_contact',email_verification_status:'valid',email_verification_provider:'aws_ses',email_verification_reason:'Overall HIGH; syntax/DNS HIGH; mailbox '+p.mailbox_existence+'; disposable/random/role LOW.',email_verification_checked_at:p.checked_at,email_verified_at:at});
 const evidence={contact_id:p.id,recipient:p.email,sender:p.sender,content_hash:p.content_hash,owner_authorized:true,context_complete:true,mailbox_checked:true,email_validation_status:'overall_valid_nonrisky',category_reviewed:true,contact_category:c.category||'',reviewed_by:'John — October 10 explicit authorization to send the regional nonresponder shortlist',source_url:p.source_url,source_sms_touch_id:p.first_sms_touch_id,expires_at:new Date(Date.now()+30*60000).toISOString()};
 await db('partnership_policy_events',{},'POST',{event_key:'nonresponse-review:'+p.key,account_id:p.account_id,action_key:p.key,event_type:'nonresponse_email.reviewed',evidence});
 const senderHealthy=p.ottawa?ottawa.mailbox===p.replyTo:saturn.mailbox===p.replyTo&&health.EnforcementStatus==='HEALTHY';
 const serviceAvailable=p.ottawa||activeLocations.some(city=>norm(city)===norm(c.city))||norm(c.city)==='kitchenerwaterlooarea';
 const adapter={observedAt:new Date().toISOString(),marketActive:serviceAvailable,serviceAvailable,channelEligible:!!c.email||!!p.email,senderHealthy,sender:p.sender,contentHash:p.content_hash};
 const allowed=await db('rpc/reviewed_nonresponse_email_allowed',{},'POST',{p_contact_id:p.id,p_channel:'email',p_action_key:p.key,p_evidence:adapter});if(allowed!==true)throw Error('reviewed_followup_not_eligible');
 const reservation=await db('rpc/reserve_partnership_action',{},'POST',{p_contact_id:p.id,p_channel:'email',p_kind:'cold_introduction',p_action_key:p.key,p_evidence:adapter});if(!reservation.allowed)throw Error('policy_hold:'+reservation.reasons.join(','));
 const touchId=randomUUID(),provider=p.ottawa?'zoho':'ses';
 const metadata={source:campaign,campaign_key:campaign,provider,from:p.sender,to:p.email,subject:p.subject,reply_to:p.replyTo,source_sms_touch_id:p.first_sms_touch_id,owner_review_action_key:p.key,delivery_state:'reserved'};
 fs.writeFileSync(file,JSON.stringify({id:p.id,email:p.email,state:'reserved_do_not_retry',touchId,at}),{flag:'wx'});reserved=true;
 await db('market_touches',{},'POST',{id:touchId,contact_id:p.id,channel:'email',direction:'outbound',notes:'Subject: '+p.subject+'\n\n'+p.body,created_by:p.ottawa?'Dr. Courage':'John',metadata});
 let messageId;
 if(p.ottawa){const result=await ottawa.request(`/accounts/${ottawa.accountId}/messages`,{fromAddress:ottawa.mailbox,toAddress:p.email,subject:p.subject,content:p.body,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'});messageId=result.messageId;}
 else{const result=await ses.send(new SendEmailCommand({FromEmailAddress:p.sender,ReplyToAddresses:[p.replyTo],Destination:{ToAddresses:[p.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:p.id},{Name:'campaign',Value:campaign}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}},Headers:[{Name:'List-Unsubscribe',Value:'<mailto:'+p.replyTo+'?subject=Unsubscribe>'}]}}}));messageId=result.MessageId;}
 if(!messageId)throw Error('Ambiguous provider acceptance');const receipt={id:p.id,email:p.email,region:p.region,provider,state:'accepted',touchId,messageId:String(messageId),at:new Date().toISOString()};fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:String(messageId)}});
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{last_touch_at:receipt.at,email_last_sent_at:receipt.at,email_provider:provider,email_provider_message_id:String(messageId),email_campaign_name:campaign,sequence_paused:true,sequence_paused_reason:'owner_reviewed_regional_email_followup_await_response',next_follow_up:null});
 const [logged]=await read('market_touches',{id:'eq.'+touchId});if(logged.metadata?.provider_message_id!==String(messageId))throw Error('CRM receipt mismatch');accepted++;
 }catch(e){if(reserved)throw e;fs.writeFileSync(file,JSON.stringify({id:p.id,email:p.email,region:p.region,state:'held',reason:e.message},null,2));held++;if(!e.message.startsWith('policy_hold:')&&!['changed_shared_context','new_mailbox_correspondence','suppressed_or_changed_contact','email_route_or_history_changed','identity_or_sms_evidence_changed','existing_email_reservation','ses_suppressed','reviewed_followup_not_eligible'].includes(e.message))throw e;}
 console.log(JSON.stringify({processed:index+1,total:plans.length,accepted,held}));
}
console.log(JSON.stringify({finished:true,accepted,held}));
