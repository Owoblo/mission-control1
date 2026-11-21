import './gta-email-recovery-runtime.mjs';
import {db,headers,base} from './reply-runtime-20261015.mjs';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
process.loadEnvFile('.env.ses.local');
const dir='artifacts/news-radar-deep-20261016';
const preflight=JSON.parse(await fs.readFile(dir+'/preflight.json'));
const candidates=JSON.parse(await fs.readFile(dir+'/candidates.json'));
const sig='\n\nJohn Owolabi\nSaturn Star Movers\n226-773-2993 | business@starmovers.ca\nhttps://starmovers.ca\n3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4';
const dexaSig='\n\nDr. Courage\nDexa Movers\n613-519-3236 | hello@dexamovers.ca\nhttps://dexamovers.ca';
const plans=candidates.filter(p=>preflight.some(r=>r.target.key===p.key)).map(p=>({...p,body:p.body+(((p.city==='Ottawa'||p.brand==='dexa')||p.brand==='dexa')?dexaSig:sig),sender:((p.city==='Ottawa'||p.brand==='dexa')||p.brand==='dexa')?'Dr. Courage | Dexa Movers <hello@dexamovers.ca>':'John | Saturn Star Movers <john@saturnstarmovers.ca>',actionKey:'news-radar-deep-20261016-'+p.key}));
await fs.writeFile(dir+'/send-plan.json',JSON.stringify(plans,null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify({prepared:plans.length}));process.exit(0);}
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const boxes={saturn:await openZohoMailbox('saturn'),ottawa:await openZohoMailbox('ottawa')};
await fs.mkdir(dir+'/receipts',{recursive:true});
for(const p of plans){
 if(process.env.RADAR_ONLY_KEY && p.key!==process.env.RADAR_ONLY_KEY)continue;
 const path=dir+'/receipts/'+p.key+'.json';
 if(await fs.stat(path).catch(()=>null)){console.log(JSON.stringify({key:p.key,skipped:'receipt exists; no retry'}));continue;}
 try{
 const audit=preflight.find(r=>r.target.key===p.key);
 if(audit.technicalHold||!audit.validation||Date.now()-Date.parse(audit.at)>86400000||audit.suppression||audit.validation.IsValid.ConfidenceVerdict==='LOW'||audit.validation.Evaluations.MailboxExists.ConfidenceVerdict==='LOW'||audit.mail.length||['IsDisposable','IsRandomInput'].some(k=>audit.validation.Evaluations[k]?.ConfidenceVerdict==='HIGH'))throw Error('Preflight hold');
 // Re-read both mailbox profiles immediately before reservation.
 for(const box of Object.values(boxes))for(const query of ['sender:'+p.domain,'to:'+p.domain]){
  const rows=await box.request('/accounts/'+box.accountId+'/messages/search?'+new URLSearchParams({searchKey:query,start:'1',limit:'200',includeto:'true'}));
  if(!Array.isArray(rows)||rows.length)throw Error('Mailbox correspondence needs review');
 }
 const domainContacts=await db('market_contacts',{email:'ilike.*@*'+p.domain,limit:1000});
 if(domainContacts.length===1000)throw Error('Contact pagination');
 if(domainContacts.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)))throw Error('Domain contact suppression requires review');
 let [c]=await db('market_contacts',{email:'ilike.'+p.email});
 if(!c){[c]=await db('market_contacts',{},'POST',{id:randomUUID(),name:p.name,company:p.company,email:p.email,city:p.city,province:'ON',industry:'commercial relationship',category:'market-signal',stage:'target',owner_name:(p.city==='Ottawa'||p.brand==='dexa')?'Dr. Courage':'John',owner_email:(p.city==='Ottawa'||p.brand==='dexa')?'hello@dexamovers.ca':'business@starmovers.ca',preferred_channel:'email',sequence_paused:true,sequence_paused_reason:'Owner-reviewed news signal; human follow-up only',source_csv:'news-radar-20261016',...(p.existing_company_id?{partner_company_id:p.existing_company_id}:{}),notes:JSON.stringify({role:p.role,source_urls:[p.source],checked_at:audit.at,email_assessment:audit.validation,mailbox_existence:'MEDIUM; not guaranteed',owner_authorization:'User requested decision-maker research and emails from radar; use playbook',signal:p.key,role_source:p.role_source,project_source:p.project_source,postal_city:p.postal_city,geography_note:p.geography_note,brand_note:p.brand_note})});}
 const companyIds=new Set([c.partner_company_id,...domainContacts.map(x=>x.partner_company_id)].filter(Boolean));
 const companyContacts=await db('market_contacts',{partner_company_id:'in.('+[...companyIds].join(',')+')',limit:1000});
 const ids=[...new Set([c.id,...domainContacts.map(x=>x.id),...companyContacts.map(x=>x.id)])];
 const touches=await db('market_touches',{contact_id:'in.('+ids.join(',')+')',order:'created_at.asc',limit:1000});
 const tasks=await db('crm_tasks',{status:'in.(open,in_progress)',related_type:'in.(partner,relationship)',related_id:'in.('+[...companyIds,...ids].join(',')+')',limit:1000});
 if(touches.length===1000||tasks.length===1000||(tasks.length&&p.key!=='slep'))throw Error('Account history/tasks require review');
 const baseline=audit.crm.flatMap(x=>x.touches.map(y=>y.id));
 if(p.key==='cbre_sharpe'){const reviewed=JSON.parse(await fs.readFile(dir+'/cbre-full-account-review.json'));if(reviewed.some(r=>r.touches.some(t=>t.direction==='inbound')||r.contact.do_not_contact||r.contact.email_unsubscribed_at||r.contact.cross_channel_suppressed_at))throw Error('CBRE reviewed history hold');baseline.push(...reviewed.flatMap(r=>r.touches.map(t=>t.id)));}
 if(touches.some(t=>!baseline.includes(t.id)))throw Error('Account history changed or new association requires review');
 if(!['slep','cbre_sharpe'].includes(p.key)&&touches.length)throw Error('Prior history requires tailored follow-up');
 if(p.key==='slep'&&touches.some(t=>t.direction==='inbound'&&!['delivered','opened','clicked','delivery'].includes(t.metadata?.event)))throw Error('SLEP inbound requires review');
 const content=p.subject+'\n'+p.body,at=new Date().toISOString();
 await fs.writeFile(dir+'/'+p.key+'-account-review.json',JSON.stringify({at,contact:c,companyContacts,touches,tasks},null,2));
 const event={event_key:'signal-review:'+p.actionKey,account_id:c.partner_company_id,action_key:p.actionKey,event_type:'signal_introduction.reviewed',occurred_at:at,evidence:{contact_id:c.id,channel:'email',recipient:c.email,sender:p.sender,content_hash:createHash('sha256').update(content).digest('hex'),reviewed_by:'Codex under John’s explicit radar-outreach authorization',source_url:p.source,expires_at:new Date(Date.now()+3600000).toISOString(),reviewed_tasks:tasks,preflight_file:dir+'/preflight.json'}};
 if(!(await db('partnership_policy_events',{event_key:'eq.'+event.event_key})).length)await db('partnership_policy_events',{},'POST',event);
 const reservation=await reserveAction({url:base,headers,contactId:c.id,channel:'email',kind:'cold_introduction',key:p.actionKey,content,sender:p.sender,...((p.city==='Ottawa'||p.brand==='dexa')?{emailProvider:'zoho'}:{})});
 const touchId=randomUUID(),metadata={source:'news_radar_20261016',source_url:p.source,policy_action_key:p.actionKey,provider:(p.city==='Ottawa'||p.brand==='dexa')?'zoho':'ses',delivery_state:'reserved_not_confirmed',from:p.sender,to:p.email,subject:p.subject};
 await fs.writeFile(path,JSON.stringify({state:'reserved_no_blind_retry',plan:p,contactId:c.id,touchId,reservation,at},null,2),{flag:'wx'});
 await db('market_touches',{},'POST',{id:touchId,contact_id:c.id,channel:'email',direction:'outbound',notes:'Subject: '+content,created_by:(p.city==='Ottawa'||p.brand==='dexa')?'Dr. Courage':'John',metadata});
 let messageId;
 if((p.city==='Ottawa'||p.brand==='dexa')){
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
