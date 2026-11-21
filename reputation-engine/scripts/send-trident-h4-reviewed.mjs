import fs from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { SESv2Client,SendEmailCommand } from '@aws-sdk/client-sesv2';
import { reserveAction } from '../lib/partnership-core/reserve.mjs';
const out='deliverables/trident-h4-20260921';
const execute=process.argv.includes('--send');
const sender='john@saturnstarmovers.ca';
const signature='\n\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | https://starmovers.ca\n\nIf you prefer no further emails from us, please reply and let me know.';
const targets=[
{key:'signal-trident-wallaceburg-20260921',company:'Trident Builders',name:'Trident Builders team',city:'Wallaceburg',email:'admin@trident-builders.ca',phone:'+14165682000',source:'https://obd.hcraontario.ca/api/buildersummary?id=B62431',subject:'Local moving support for your Wallaceburg buyers',body:"Hi Trident team,\n\nI'm John with Saturn Star Movers. I saw the news about your open house at the former W.T. Laing school site in Wallaceburg.\n\nWe support residential moves in Chatham-Kent. I'd like to explore being a local moving contact your sales team can offer buyers as homes are ready, with each move quoted around the buyer's dates and needs. We can also discuss furniture moving for a model home if useful.\n\nWho handles buyer move-in partnerships for the Elizabeth Street project? I'd be happy to send our details or arrange a brief introduction.",note:'Market is Wallaceburg project service area; registered office is 5306 Creditview Road, Mississauga. Registry umbrella links 2788602 and project entity 2873723 Ontario Inc. Person name not independently confirmed; address team. Twilio Lookup valid CA but line_type_intelligence error60601; no SMS.'},
{key:'signal-sem-moving-supplier-20260921',company:'S.E.M. Construction',name:'S.E.M. estimating team',city:'London',email:'estimating@semconstruction.ca',phone:'+15194323333',source:'https://www.semconstruction.ca/contact-us/',subject:'Moving support for renovation projects in Windsor–Essex',body:"Hi S.E.M. team,\n\nI'm John with Saturn Star Movers. We help with furniture moving and client relocations across Windsor and Essex County.\n\nI'd like to introduce Saturn as a moving subcontractor for renovation projects where contents need to be moved out, relocated between spaces, or returned after work is complete. We'd quote against the scope and schedule your team provides.\n\nWho handles moving subcontractors or your vendor list? Happy to send a short company overview to the right person.",note:'No assertion about H4 award status or tender participation. Official estimating inbox.'},
{key:'signal-h4-housing-move-routing-20260921',company:'City of Windsor',name:'Kelly Goz',city:'Windsor',email:'kgoz@citywindsor.ca',phone:null,source:'https://www.citywindsor.ca/residents/housing/housing-with-supports-and-homelessness-prevention/homelessness/housing-hub-h4',subject:'H4 — contact for moves into housing',body:"Hi Kelly,\n\nI'm John with Saturn Star Movers in Windsor. The City's H4 page lists you as a project contact, and I wondered if you could point me in the right direction.\n\nWe'd like to understand how moving support is arranged when someone supported by H4 transitions into housing, and whether there is a process for local moving companies to be considered.\n\nWho coordinates those moves, and is there a supplier registration or referral process we should follow?",note:'Routing inquiry separate from H4 construction procurement. No free/discounted commitment or request for client personal information.'}
].map(t=>({...t,body:t.body+signature}));
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q={},method='GET',body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(table+' HTTP '+r.status);const txt=await r.text();return txt?JSON.parse(txt):[];}
const report={at:new Date().toISOString(),execute,targets:[]};
for(const t of targets){
 try{
  const matches=await db('market_contacts',{or:'(email.eq.'+t.email+(t.phone?',phone.eq.'+t.phone:'')+')',select:'*'});
  if(matches.length>1)throw Error('Ambiguous existing identity');
  let contact=matches[0];
  if(contact){const touches=await db('market_touches',{contact_id:'eq.'+contact.id,direction:'eq.outbound',select:'id,metadata',limit:'1'});if(touches.length)throw Error('Existing outbound conversation: review before another introduction');}
  if(!execute){report.targets.push({...t,existingContactId:contact?.id||null,state:'draft_not_sent'});continue;}
  if(!contact){[contact]=await db('market_contacts',{},'POST',{id:randomUUID(),name:t.name,company:t.company,email:t.email,...(t.phone?{phone:t.phone}:{}),city:t.city,province:'ON',category:'commercial_relationship',industry:'commercial relationship',stage:'target',owner_name:'John',sequence_paused:true,sequence_paused_reason:'Reviewed opportunity; no generic automated sequence',source_csv:'verified-signal-20260921',notes:JSON.stringify({source:t.source,context:t.note})});}
  if(!contact?.partner_company_id)throw Error('Account identity not linked');
  // Canonical policy makes the final decision; no synthetic eligibility overrides.
  const reservation=await reserveAction({url:process.env.SUPABASE_URL,headers,contactId:contact.id,channel:'email',kind:'cold_introduction',key:t.key,content:t.subject+'\n'+t.body,sender,emailProvider:'ses'});
  const touchId=randomUUID();const metadata={source:'verified_market_signal',policy_action_key:t.key,to:t.email,from:sender,subject:t.subject,provider:'ses',delivery_state:'reserved_not_confirmed',source_url:t.source};
  await db('market_touches',{},'POST',{id:touchId,contact_id:contact.id,channel:'email',direction:'outbound',notes:'Subject: '+t.subject+'\n\n'+t.body,created_by:'John — authorized opportunity outreach',metadata});
  fs.writeFileSync(out+'/'+t.key+'-reservation.json',JSON.stringify({contactId:contact.id,touchId,reservation,metadata},null,2));
  const ses=new SESv2Client({region:process.env.AWS_REGION||process.env.AWS_DEFAULT_REGION||'ca-central-1',maxAttempts:1});
  const receipt=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <'+sender+'>',ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[t.email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET||undefined,EmailTags:[{Name:'contact_id',Value:contact.id},{Name:'signal_key',Value:t.key}],Content:{Simple:{Subject:{Data:t.subject,Charset:'UTF-8'},Body:{Text:{Data:t.body,Charset:'UTF-8'}}}}}));
  if(!receipt.MessageId)throw Error('Ambiguous provider acceptance: inspect reservation before retry');
  const accepted={key:t.key,contactId:contact.id,touchId,to:t.email,state:'accepted',messageId:receipt.MessageId,at:new Date().toISOString()};
  fs.writeFileSync(out+'/'+t.key+'-receipt.json',JSON.stringify(accepted,null,2));
  await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:receipt.MessageId}});
  await db('market_contacts',{id:'eq.'+contact.id},'PATCH',{last_touch_at:accepted.at,email_last_sent_at:accepted.at,email_provider:'ses',email_provider_message_id:receipt.MessageId});
  report.targets.push(accepted);
 }catch(error){report.targets.push({key:t.key,to:t.email,state:'held_or_failed',reason:error.message});}
 fs.writeFileSync(out+'/execution.json',JSON.stringify(report,null,2));
}
fs.writeFileSync(out+(execute?'/execution.json':'/prepared.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.targets.map(t=>({key:t.key,to:t.email||t.to,state:t.state,reason:t.reason,messageId:t.messageId})),null,2));
