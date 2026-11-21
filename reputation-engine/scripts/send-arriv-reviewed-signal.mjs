import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const contactId='59ae9f24-8680-4ed3-a618-a8bde0df7dd7';
const key='signal-och-south-centrepointe-20260919';
const sender='Dr. Courage | Dexa Movers <hello@dexamovers.ca>';
const subject='Moving support for ARRIV’s South Centrepointe portfolio';
const body=`Hi ARRIV team,

I’m Dr. Courage with Dexa Movers in Ottawa. I saw the announcement about the 503 South Centrepointe homes joining OCH’s portfolio, operated by ARRIV.

If your team needs moving support for future resident transfers, move-ins or move-outs, we’d welcome the opportunity to help. We can discuss the scheduling, building access and furniture-moving requirements with your team before quoting the work.

Who handles moving-service providers for this portfolio? I’d be happy to send our company details or arrange a short introduction with the right person.

Dr. Courage
Dexa Movers
613-519-3236
hello@dexamovers.ca
https://dexamovers.ca

If you prefer no further emails from us, please reply and let me know.`;
const path='partnership-system/state/arriv-dexa-signal.json';
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q={},method='GET',data){
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(table+' '+r.status); return r.status===204?[]:r.json();
}
const [contact]=await db('market_contacts',{id:'eq.'+contactId});
if(contact?.email!=='info@arriv.ca'||contact?.city!=='Ottawa'||!contact.partner_company_id)throw Error('ARRIV identity changed; re-review required');
let mailbox;
let mailboxError;
try { mailbox=await openZohoMailbox('ottawa'); } catch { mailboxError='Dexa mailbox verification unavailable with the local credentials'; }
const history=await db('market_touches',{contact_id:'eq.'+contactId,direction:'eq.outbound',select:'id,metadata',limit:1});
if(history.length)throw Error('Outbound history exists; inspect before sending');
if(process.argv.includes('--prepare')){
 await db('market_contacts',{id:'eq.'+contactId},'PATCH',{owner_name:'Dr. Courage',owner_email:'hello@dexamovers.ca',assigned_manager_user_id:'8c5cd149-afb7-4c54-8299-e295da2f43b6'});
 await db('crm_tasks',{source_key:'eq.'+key+':direct-mail-review'},'PATCH',{title:'ARRIV: confirm recipient and prepare physical Dexa letter',category:'partnership_print_delivery',owner_name:'Dr. Courage',owner_user_id:'8c5cd149-afb7-4c54-8299-e295da2f43b6',branch:'ottawa',description:JSON.stringify({channel:'direct_mail',state:'not_printed_not_mailed',next_action:'Verify ARRIV mailing recipient and office, then prepare and dispatch a Dexa capability letter. Email delivery does not complete this task.',candidate_address:'731 Chapel Cres, Ottawa, ON K1N 1E1',address_verified_for_arriv:false}),updated_at:new Date().toISOString()});
 await fs.writeFile(path,JSON.stringify({state:'prepared_not_sent',sender,to:contact.email,subject,body,mailboxVerified:mailbox?.mailbox||false,mailboxError,blockingMigration:'20260919000300_reviewed_signal_task_context.sql',physicalMailSent:false},null,2));
 console.log(JSON.stringify({prepared:true,mailbox:mailbox?.mailbox||null,mailboxError,sent:false}));
}else if(process.argv.includes('--send')){
 if(!mailbox)throw Error(mailboxError);
 // The review is immutable and short-lived; changed/expired reviews need a new review.
 const ids=await db('market_contacts',{partner_company_id:'eq.'+contact.partner_company_id,select:'id'});
 const tasks=await db('crm_tasks',{status:'in.(open,in_progress)',related_type:'in.(partner,relationship)',related_id:'in.('+[contact.partner_company_id,...ids.map(c=>c.id)].join(',')+')',limit:1000});
 if(tasks.length>=1000||tasks.some(t=>t.source_key!==key+':direct-mail-review'))throw Error('Additional account work requires review');
 const now=new Date();
 const review={event_key:'signal-review:'+key,account_id:contact.partner_company_id,action_key:key,event_type:'signal_introduction.reviewed',occurred_at:now.toISOString(),evidence:{contact_id:contactId,channel:'email',recipient:contact.email,sender,content_hash:createHash('sha256').update(subject+'\n'+body).digest('hex'),reviewed_by:'John, explicit authorization in session',source_url:'https://www.och-lco.ca/contact/',source_note:'Owner supplied ARRIV routing and acquisition context',expires_at:new Date(+now+86400000).toISOString(),reviewed_tasks:tasks}};
 const previous=await db('partnership_policy_events',{event_key:'eq.'+review.event_key});
 if(!previous.length)await db('partnership_policy_events',{},'POST',review);
 await reserveAction({url:process.env.SUPABASE_URL,headers,contactId,channel:'email',kind:'cold_introduction',key,content:subject+'\n'+body,sender});
 const h=createHash('sha256').update(key+':dexa-touch').digest('hex');
 const touchId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
 const metadata={from:sender,to:contact.email,subject,provider:'zoho',policy_action_key:key,delivery_state:'reserved_not_confirmed'};
 await db('market_touches',{},'POST',{id:touchId,contact_id:contactId,channel:'email',direction:'outbound',notes:'Subject: '+subject+'\n\n'+body,created_by:'Dr. Courage',metadata});
 await fs.writeFile(path,JSON.stringify({state:'reserved_not_confirmed',touchId,subject,body,sender},null,2));
 const result=await mailbox.request('/accounts/'+encodeURIComponent(mailbox.accountId)+'/messages',{fromAddress:mailbox.mailbox,toAddress:contact.email,subject,content:body,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'});
 if(!result?.messageId)throw Error('Provider response ambiguous; inspect reservation before retry');
 const receipt={state:'accepted',provider:'zoho',messageId:result.messageId,touchId,contactId,sender,to:contact.email,subject,body,at:new Date().toISOString(),physicalMailSent:false};
 await fs.writeFile(path,JSON.stringify(receipt,null,2));
 await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:result.messageId}});
 await db('market_contacts',{id:'eq.'+contactId},'PATCH',{last_touch_at:receipt.at,email_last_sent_at:receipt.at,sequence_paused:true,sequence_paused_reason:'Await ARRIV response to Dexa introduction'});
 console.log(JSON.stringify({accepted:true,messageId:result.messageId,physicalMailSent:false}));
}else throw Error('Use --prepare or --send');
