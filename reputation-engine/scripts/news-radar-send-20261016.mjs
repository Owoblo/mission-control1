import './gta-email-recovery-runtime.mjs';
import {db,headers,base} from './reply-runtime-20261015.mjs';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
process.loadEnvFile('.env.ses.local');
const dir='artifacts/news-radar-outreach-20261016';
const preflight=JSON.parse(await fs.readFile(dir+'/preflight.json'));
const messages={
brant:{subject:'Supplier planning for the new Central Branch',body:`Hi Kelly,\n\nI’m John with Saturn Star Movers. I saw the approval of Phase 1 for the new Central Branch in Paris and understand the opening is still a future phase.\n\nWe’d welcome the opportunity to quote furniture and boxed-content moves when that work is defined. What is the right supplier-registration or procurement route for future moving work on the project?\n\nI’m happy to send our company details to you or Karen Scott if useful.`},
western:{subject:'Household moving support for incoming family medicine residents',body:`Hi Liz,\n\nI’m John with Saturn Star Movers. The growth of family medicine training in Tillsonburg caught my attention, and your role with the postgraduate program looked like the right place to ask.\n\nWe can quote household moves for residents settling in London or Tillsonburg, based on their dates, inventory and access. Does your team maintain a local moving-resource list that incoming residents can choose from?\n\nIf so, I’d be happy to send our details for consideration.`},
limitless:{subject:'Moving support for the planned London and Hamilton openings',body:`Hi Faisal,\n\nI’m John with Saturn Star Movers. I saw Limitless Tire’s October 6 announcement about the planned London and Hamilton locations.\n\nWe’d be interested in quoting the office furniture and boxed supplies portion of opening-day logistics, once the locations and dates are settled. Who coordinates that moving scope for new franchise locations?\n\nI can send our details to the person handling it.`},
gohba:{subject:'Builder move-in support — the right GOHBA route',body:`Hi Soula,\n\nI’m Dr. Courage with Dexa Movers in Ottawa. John at Saturn Star Movers previously contacted GOHBA about builder moving support; I’m picking up the local introduction because you handle membership and business development.\n\nWe’d like to offer household moving quotes to buyers approaching their builder handover dates. What is the appropriate route for a local moving company to introduce its services to interested GOHBA members?\n\nI’d be happy to send our company details for your review.`},
ledc:{subject:'Pharmaline London — employee relocation contact',body:`Hi Christine,\n\nI’m John with Saturn Star Movers. I read LEDC’s announcement about Pharmaline’s new London facility and the planned jobs.\n\nIf incoming hires need household moving support as recruitment develops, we’d welcome the opportunity to provide individual quotes. Could you point me to the person coordinating employee relocation or onboarding for the London site?\n\nI’m happy to send a short company introduction for you to forward.`},
ckha:{subject:'Wallaceburg redevelopment — moving supplier enquiry',body:`Hi Fannie,\n\nI’m John with Saturn Star Movers. I saw the latest Wallaceburg redevelopment planning update and Terra Kitzul Arens’s comments on the facilities work.\n\nWe’d be interested in quoting ordinary office furniture and boxed-content moves if those needs arise during the project. Could you point me to the facilities or procurement contact who handles that scope and supplier registration?\n\nI’d be happy to send our company details for review.`}
};
const sig='\n\nJohn Owolabi\nSaturn Star Movers\n226-773-2993 | business@starmovers.ca\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4';
const dexaSig='\n\nDr. Courage\nDexa Movers\n613-519-3236 | hello@dexamovers.ca\nhttps://dexamovers.ca';
const plans=preflight.map(r=>({...r.target,...messages[r.target.key],body:messages[r.target.key].body+(r.target.city==='Ottawa'?dexaSig:sig),sender:r.target.city==='Ottawa'?'Dr. Courage | Dexa Movers <hello@dexamovers.ca>':'John | Saturn Star Movers <john@saturnstarmovers.ca>',actionKey:'news-radar-20261016-'+r.target.key}));
await fs.writeFile(dir+'/send-plan.json',JSON.stringify(plans,null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify({prepared:plans.length}));process.exit(0);}
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const boxes={saturn:await openZohoMailbox('saturn'),ottawa:await openZohoMailbox('ottawa')};
await fs.mkdir(dir+'/receipts',{recursive:true});
for(const p of plans){
 const path=dir+'/receipts/'+p.key+'.json';
 if(await fs.stat(path).catch(()=>null)){console.log(JSON.stringify({key:p.key,skipped:'receipt exists; no retry'}));continue;}
 try{
 const audit=preflight.find(r=>r.target.key===p.key);
 if(Date.now()-Date.parse(audit.at)>86400000||audit.suppression||audit.validation.IsValid.ConfidenceVerdict==='LOW'||audit.validation.Evaluations.MailboxExists.ConfidenceVerdict==='LOW'||audit.mail.length)throw Error('Preflight hold');
 // Re-read both mailbox profiles immediately before reservation.
 for(const box of Object.values(boxes))for(const query of ['sender:'+p.domain,'to:'+p.domain]){
  const rows=await box.request('/accounts/'+box.accountId+'/messages/search?'+new URLSearchParams({searchKey:query,start:'1',limit:'200',includeto:'true'}));
  if(!Array.isArray(rows)||rows.length)throw Error('Mailbox correspondence needs review');
 }
 const domainContacts=await db('market_contacts',{email:'ilike.*@*'+p.domain,limit:1000});
 if(domainContacts.length===1000)throw Error('Contact pagination');
 if(domainContacts.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)))throw Error('Domain contact suppression requires review');
 let [c]=await db('market_contacts',{email:'ilike.'+p.email});
 if(!c){[c]=await db('market_contacts',{},'POST',{id:randomUUID(),name:p.name,company:p.company,email:p.email,city:p.city,province:'ON',industry:'commercial relationship',category:'market-signal',stage:'target',owner_name:p.city==='Ottawa'?'Dr. Courage':'John',owner_email:p.city==='Ottawa'?'hello@dexamovers.ca':'business@starmovers.ca',preferred_channel:'email',sequence_paused:true,sequence_paused_reason:'Owner-reviewed news signal; human follow-up only',source_csv:'news-radar-20261016',...(p.key==='gohba'?{partner_company_id:'d6200c60-73b0-4b25-9df0-69668953a8ab'}:{}),notes:JSON.stringify({role:p.role,source_urls:[p.source],checked_at:audit.at,email_assessment:audit.validation,mailbox_existence:'MEDIUM; not guaranteed',owner_authorization:'User requested decision-maker research and emails from radar; use playbook',signal:p.key})});}
 const companyIds=new Set([c.partner_company_id,...domainContacts.map(x=>x.partner_company_id)].filter(Boolean));
 const companyContacts=await db('market_contacts',{partner_company_id:'in.('+[...companyIds].join(',')+')',limit:1000});
 const ids=[...new Set([c.id,...domainContacts.map(x=>x.id),...companyContacts.map(x=>x.id)])];
 const touches=await db('market_touches',{contact_id:'in.('+ids.join(',')+')',order:'created_at.asc',limit:1000});
 const tasks=await db('crm_tasks',{status:'in.(open,in_progress)',related_type:'in.(partner,relationship)',related_id:'in.('+[...companyIds,...ids].join(',')+')',limit:1000});
 if(touches.length===1000||tasks.length===1000||tasks.length)throw Error('Account history/tasks require review');
 const baseline=audit.crm.flatMap(x=>x.touches.map(y=>y.id));
 if(touches.some(t=>!baseline.includes(t.id)))throw Error('Account history changed or new association requires review');
 if(p.key!=='gohba'&&touches.length)throw Error('Prior history requires tailored follow-up');
 if(p.key==='gohba'&&touches.some(t=>t.direction==='inbound'&&!['delivered','opened','clicked','delivery'].includes(t.metadata?.event)))throw Error('GOHBA inbound requires review');
 const content=p.subject+'\n'+p.body,at=new Date().toISOString();
 await fs.writeFile(dir+'/'+p.key+'-account-review.json',JSON.stringify({at,contact:c,companyContacts,touches,tasks},null,2));
 const event={event_key:'signal-review:'+p.actionKey,account_id:c.partner_company_id,action_key:p.actionKey,event_type:'signal_introduction.reviewed',occurred_at:at,evidence:{contact_id:c.id,channel:'email',recipient:c.email,sender:p.sender,content_hash:createHash('sha256').update(content).digest('hex'),reviewed_by:'Codex under John’s explicit radar-outreach authorization',source_url:p.source,expires_at:new Date(Date.now()+3600000).toISOString(),reviewed_tasks:tasks,preflight_file:dir+'/preflight.json'}};
 if(!(await db('partnership_policy_events',{event_key:'eq.'+event.event_key})).length)await db('partnership_policy_events',{},'POST',event);
 const reservation=await reserveAction({url:base,headers,contactId:c.id,channel:'email',kind:'cold_introduction',key:p.actionKey,content,sender:p.sender});
 const touchId=randomUUID(),metadata={source:'news_radar_20261016',source_url:p.source,policy_action_key:p.actionKey,provider:p.city==='Ottawa'?'zoho':'ses',delivery_state:'reserved_not_confirmed',from:p.sender,to:p.email,subject:p.subject};
 await fs.writeFile(path,JSON.stringify({state:'reserved_no_blind_retry',plan:p,contactId:c.id,touchId,reservation,at},null,2),{flag:'wx'});
 await db('market_touches',{},'POST',{id:touchId,contact_id:c.id,channel:'email',direction:'outbound',notes:'Subject: '+content,created_by:p.city==='Ottawa'?'Dr. Courage':'John',metadata});
 let messageId;
 if(p.city==='Ottawa'){
  const box=boxes.ottawa,result=await box.request('/accounts/'+box.accountId+'/messages',{fromAddress:box.mailbox,toAddress:p.email,subject:p.subject,content:p.body,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'});messageId=result?.messageId;
 }else{
  if(!process.env.AWS_SES_CONFIGURATION_SET)throw Error('Missing SES configuration set');
  const result=await ses.send(new SendEmailCommand({FromEmailAddress:p.sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[p.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:c.id},{Name:'signal_key',Value:p.actionKey}],Content:{Simple:{Subject:{Data:p.subject,Charset:'UTF-8'},Body:{Text:{Data:p.body,Charset:'UTF-8'}}}}}));messageId=result.MessageId;
 }
 if(!messageId)throw Error('Ambiguous provider response; no retry');
 const receipt={state:'accepted',at:new Date().toISOString(),plan:p,contactId:c.id,touchId,messageId,provider:metadata.provider};
 await fs.writeFile(path,JSON.stringify(receipt,null,2));
 await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:messageId},next_step:'Await human reply; no automatic follow-up.'});
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{last_touch_at:receipt.at,email_last_sent_at:receipt.at,email_provider:metadata.provider,email_provider_message_id:messageId,sequence_paused:true,sequence_paused_reason:'News radar introduction sent; await human reply',next_follow_up:null});
 console.log(JSON.stringify({key:p.key,state:'accepted',messageId}));
 }catch(e){const failure={key:p.key,state:'held_or_failed',error:e.message,at:new Date().toISOString()};await fs.writeFile(dir+'/'+p.key+'-hold.json',JSON.stringify(failure,null,2));console.log(JSON.stringify(failure));}
}
