import fs from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {SESv2Client, SendEmailCommand} from '@aws-sdk/client-sesv2';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';

const out='partnership-system/state/signal-opportunities-20260919.json';
const env=k=>String(process.env[k]||'').trim();
const headers={apikey:env('SUPABASE_KEY'),Authorization:`Bearer ${env('SUPABASE_KEY')}`,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q={},method='GET',body,prefer='return=representation'){
  const r=await fetch(`${env('SUPABASE_URL')}/rest/v1/${table}?${new URLSearchParams(q)}`,{method,headers:{...headers,Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});
  const t=await r.text(); if(!r.ok) throw Error(`${table} ${r.status} ${t.slice(0,500)}`); return t?JSON.parse(t):[];
}
const uid=s=>{const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
const sender='john@saturnstarmovers.ca';
const targets=[
 {key:'signal-och-south-centrepointe-20260919',email:'info@arriv.ca',name:'ARRIV Properties — South Centrepointe routing',company:'ARRIV Properties',city:'Ottawa',province:'ON',subject:'Move support for the South Centrepointe portfolio',source:'https://www.och-lco.ca/contact/',body:`Hi ARRIV team,\n\nI saw the news about the 503 homes in South Centrepointe now under OCH management. That is a substantial number of tenant transitions moving through one portfolio.\n\nI’m John with Saturn Star Movers. We handle residential moves across Ottawa and work with housing providers as a move coordinator: scheduled move windows, one point of contact, and clean turnovers between tenants.\n\nWould a 10-minute call this week be useful to see whether we could support ARRIV on tenant moves, move-ins, move-outs, or related turnover work? If another person owns vendor partnerships or resident transition logistics, I’d appreciate being pointed in the right direction.\n\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | starmovers.ca\n\nIf this is not relevant, reply and I’ll close the loop.`},
 {key:'signal-canadian-energies-chatham-20260919',email:'stuartm@chatham-kent.ca',name:'Stuart McFadden — Economic Development',company:'Municipality of Chatham-Kent',city:'Chatham',province:'ON',subject:'Local mover for the incoming Chatham-Kent energy project',source:'https://www.chatham-kent.ca/business/economic-development',body:`Hi Stuart,\n\nI’m John with Saturn Star Movers in Windsor. I’m following the Canadian Energies clean-energy manufacturing proposal. It is still conditional on approval, but if it proceeds, the workforce and supplier activity could create significant relocation needs in Chatham-Kent and across Southwestern Ontario.\n\nI’d like Saturn positioned early as a workforce-relocation and move-support partner. Could you point me to the vendor-list or project contact for moving and relocation services as the file develops?\n\nI’m also happy to come to Chatham for a brief introduction whenever useful.\n\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | starmovers.ca\n\nIf this belongs with another team, please forward it or let me know the right contact.`}
];
const report={startedAt:new Date().toISOString(),targets:[],tasks:[]};
for(const t of targets){
  try {
  if(t.city==='Ottawa')throw Error('Ottawa uses scripts/send-arriv-reviewed-signal.mjs with Dr. Courage / Dexa');
  let [contact]=await db('market_contacts',{email:`eq.${t.email}`,select:'id,name,company,email,city,province,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at'});
  if(!contact){
    [contact]=await db('market_contacts',{},'POST',{id:randomUUID(),name:t.name,company:t.company,email:t.email,city:t.city,province:t.province,industry:'commercial relationship',category:'market-signal',stage:'target',owner_name:'John',sequence_paused:true,sequence_paused_reason:'Signal-based introduction; awaiting response',source_csv:'market-signal-20260919',notes:JSON.stringify({source:t.source,signal_key:t.key,verified_route:true})});
  }
  const taskKey=`${t.key}:direct-mail-review`;
  const existing=await db('crm_tasks',{source_key:`eq.${taskKey}`,select:'id'});
  if(!existing.length){
    const address=t.email==='info@arriv.ca'?'731 Chapel Cres, Ottawa, ON K1N 1E1':'Confirm Chatham-Kent project office and named recipient before mailing';
    await db('crm_tasks',{},'POST',{id:uid(taskKey),title:`${t.company}: prepare signal follow-up and direct mail`,description:JSON.stringify({signal:t.key,source:t.source,next_action:'Review reply and prepare a one-page capability letter; do not mail until recipient/office is confirmed.',mailing_note:address,owner:'John'}),status:'open',priority:'high',category:'partnership_conversation_followthrough',owner_name:'John',related_type:'relationship',related_id:contact.id,related_label:t.company,source:'manual',source_key:taskKey,created_by_name:'John — owner-authorized signal outreach'});
    report.tasks.push({contactId:contact.id,source_key:taskKey});
  }
  const prior=await db('market_touches',{contact_id:`eq.${contact.id}`,channel:'eq.email',direction:'eq.outbound',select:'notes,metadata,created_at',order:'created_at.desc',limit:'20'});
  if(prior.some(x=>x.metadata?.policy_action_key===t.key||x.notes?.includes(`Subject: ${t.subject}`))){report.targets.push({key:t.key,email:t.email,contactId:contact.id,state:'already_recorded'});continue;}
  const reservation=await reserveAction({url:env('SUPABASE_URL'),headers,contactId:contact.id,channel:'email',kind:'cold_introduction',key:t.key,content:`${t.subject}\n${t.body}`,sender});
  const touchId=uid(`${t.key}:touch`); const at=new Date().toISOString();
  await db('market_touches',{},'POST',{id:touchId,contact_id:contact.id,channel:'email',direction:'outbound',notes:`Subject: ${t.subject}\n\n${t.body}`,created_by:'John — authorized market-signal outreach',created_at:at,metadata:{source:'market_signal',signal_key:t.key,source_url:t.source,policy_action_key:t.key,delivery_state:'reserved_not_confirmed',provider:'ses',to:t.email,from:sender,subject:t.subject,reservation}});
  const ses=new SESv2Client({region:env('AWS_REGION')||'us-east-2',maxAttempts:1});
  const sent=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[t.email]},ConfigurationSetName:env('AWS_SES_CONFIGURATION_SET'),EmailTags:[{Name:'contact_id',Value:contact.id},{Name:'signal_key',Value:t.key}],Content:{Simple:{Subject:{Data:t.subject,Charset:'UTF-8'},Body:{Text:{Data:t.body,Charset:'UTF-8'}}}}}));
  if(!sent.MessageId)throw Error(`SES did not return MessageId for ${t.email}`);
  await db('market_touches',{id:`eq.${touchId}`},'PATCH',{metadata:{source:'market_signal',signal_key:t.key,source_url:t.source,policy_action_key:t.key,delivery_state:'accepted',provider:'ses',provider_message_id:sent.MessageId,to:t.email,from:sender,subject:t.subject},next_step:'Await human reply; monitor SES event for delivery/bounce.'});
  await db('market_contacts',{id:`eq.${contact.id}`},'PATCH',{last_touch_at:at,email_last_sent_at:at,email_provider:'ses',email_provider_message_id:sent.MessageId,sequence_paused:true,sequence_paused_reason:'Signal-based introduction sent; await reply'});
  report.targets.push({key:t.key,email:t.email,contactId:contact.id,state:'accepted',messageId:sent.MessageId,subject:t.subject,reservation});
  } catch (error) { report.targets.push({key:t.key,email:t.email,state:'held_or_failed',error:String(error?.message||error)}); }
}
report.completedAt=new Date().toISOString(); await fs.writeFile(out,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
