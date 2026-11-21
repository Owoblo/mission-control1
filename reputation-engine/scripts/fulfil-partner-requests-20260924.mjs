// Owner-authorized replies, September 24. Default mode prepares; --send executes once.
// Never rerun an attempted action without inspecting its receipt and provider history.
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {SESv2Client,SendEmailCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
const prod=JSON.parse(fs.readFileSync('/private/tmp/interaction-production-env.json'));
for(const k of ['SUPABASE_URL','SUPABASE_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN'])if(prod[k])process.env[k]=prod[k];
const url=process.env.SUPABASE_URL,headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
const root='deliverables/partnership-fulfilment-2026-09-24';fs.mkdirSync(root,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync('/private/tmp/partner-send-preflight.json'));
const card=city=>'https://idbyrtwdeeruiutoukct.supabase.co/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-10/'+city+'/card.jpg';
const signature='\n\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca\nhttps://starmovers.ca';
const plans=[
 {id:'68e14a95-6cb6-401f-b81c-d675dd06281d',channel:'sms',city:'windsor',body:"Thanks for getting back to me! Here is our Windsor digital card. Keep us in mind when a project needs furniture moved, a delivery coordinated, or a client relocated. — John"},
 {id:'a008f4f5-8932-4ede-9b5e-705f14a97862',channel:'sms',city:'leamington',body:"Thanks, and sorry for the slow reply! Here is our Leamington digital card. We can help with furniture handling, deliveries and client moves around renovation projects. When something comes up, send us the locations, items and timing so we can review the scope and quote. — John"},
 {id:'7cdbf129-9996-4c56-80b5-8d2940330b55',channel:'sms',city:'east-garafraxa',body:"Thanks, and sorry for the wait! Here is our digital card for East Garafraxa and surrounding areas. You can keep it handy for staging moves, furniture handling and client moves. — John"},
 {id:'01c3502d-d0bd-4e62-a03e-34e0d7aa9a37',channel:'sms',city:'brant',correctCity:'Brant',body:"Hi Lauren, yes — we cover Brant and surrounding areas. Sorry for the mix-up in my first message and the slow reply. Here is our Brant digital card for furniture handling, staging support and client moves. — John"},
 {id:'0713375c-6130-4577-8ab7-5a1ab7826b4b',channel:'sms',city:'guelph',body:"Thanks! Here is our Guelph digital card to keep handy for tenant moves or furniture moves between units. — John"},
 {id:'003d56af-41db-44c6-9122-f278076cdb4f',channel:'sms',body:"Thanks, Sam — I appreciate the introduction. I've emailed Justin our London card and moving details for the team."},
 {id:'609477df-1743-4bf8-b40b-4c651a9cb7d9',channel:'email',to:'info@blueanchorpm.rent',city:'leamington',subject:'Your requested Saturn Star Movers card — tenant and property moves',body:"Hi Blue Anchor team,\n\nThanks for sharing your email, and sorry for the slow reply. I've attached our Leamington digital card as requested. We help property managers and residents with tenant moves, furniture moves around unit turnovers, and moves into or out of storage across Windsor and Essex County.\n\nIf a resident or property project needs moving support, you can reply here with the locations, items, access details and preferred date. We'll review the scope before providing a quote. You're welcome to keep the card on file or share it when a resident asks for a mover."+signature},
 {id:'09e43ea2-187f-4482-bae5-6250d32a3902',channel:'email',to:'info@oliveandashinteriors.com',city:'east-garafraxa',subject:'Your requested Saturn Star Movers card — staging and furniture support',body:"Hi Olive + Ash team,\n\nThanks for sharing your email, and sorry for the wait. I've attached our digital card for East Garafraxa and surrounding areas, as requested.\n\nWe help with staging moves, furniture handling, deliveries, storage moves and client relocations. When a project comes up, you can reply with the pickup and delivery locations, items, access details and timing so we can review the scope and provide a quote. Feel free to keep the card handy or pass it along when a client needs moving help."+signature},
 {id:'999c5957-bbeb-4f18-ad5b-8ee44603a625',channel:'email',to:'store1063@applestorage.com',subject:'RE: A moving contact for your customers',body:"Hi Ryan,\n\nThanks for the invitation, and sorry for the slow reply. I'd be happy to meet for lunch and discuss how we could work together to help your storage customers.\n\nWeekends work well for me. Would a Saturday or Sunday over the next couple of weekends suit you? Let me know a day and time that works on your side, and we can settle on a place in Chatham.\n\nLooking forward to meeting you."+signature,ownerFact:'John confirmed weekends work for a lunch with Ryan. No date or time agreed.'},
].map(p=>{const s=snapshot.find(r=>r.contact.id===p.id);const inbound=s.touches.find(t=>t.direction==='inbound'&&['sms','email'].includes(t.channel));return {...p,name:s.contact.name,expectedLatestTouch:s.touches[0]?.id,source:inbound?.id,from:s.provider.From?.[0]?.to,media:p.city?card(p.city):undefined};});
async function db(t,q={},method='GET',body){const r=await fetch(url+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(t+' '+r.status+' '+(await r.text()).slice(0,250));return r.status===204?[]:r.json();}
fs.writeFileSync(root+'/plan.json',JSON.stringify({authorization:'User explicitly requested Ryan weekend reply, requested information/cards, and Justin via SES.',comparisons:['Chris Fischer requested Fergus card fulfilment, September 22','Attis Construction Leamington card fulfilment, September 21','Grandview Apartments requested Grand Bend card, September 21'],justin:'SES already accepted introduction and London card on September 22; touch 6a692438-b194-4050-ae71-c5622f075d2f. No duplicate send.',plans},null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify(plans.map(p=>({name:p.name,channel:p.channel,to:p.to||snapshot.find(r=>r.contact.id===p.id).contact.phone,body:p.body,media:p.media})),null,2));process.exit(0);}
const login=await fetch('https://go.quote2move.com/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:prod.AUTH_PASSWORD}),signal:AbortSignal.timeout(25000)});
if(!login.ok)throw Error('Owner login failed '+login.status);const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!cookie)throw Error('Missing session');
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
for(const p of plans){
 const receiptPath=root+'/'+p.id+'.json';if(fs.existsSync(receiptPath)){console.log(p.name,'existing receipt; skipped');continue;}
 const [c]=await db('market_contacts',{id:'eq.'+p.id});const [latest]=await db('market_touches',{contact_id:'eq.'+p.id,order:'created_at.desc',limit:'1'});
 if(latest?.id!==p.expectedLatestTouch)throw Error('New contact activity: '+p.name);
 if(c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision))throw Error('Suppressed '+p.name);
 if(p.media){const check=await fetch(p.media,{method:'HEAD'});if(!check.ok||!check.headers.get('content-type')?.startsWith('image/'))throw Error('Asset unavailable '+p.name);}
 // Recheck provider history against the reviewed snapshot immediately before sending.
 if(c.phone){for(const direction of ['To','From']){const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json?`+new URLSearchParams({[direction]:c.phone,PageSize:'1'}),{headers:{Authorization:'Basic '+Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64')}});if(!r.ok)throw Error('Provider check unavailable');const now=(await r.json()).messages[0];const old=snapshot.find(x=>x.contact.id===p.id).provider[direction]?.[0];if(now?.sid!==old?.sid)throw Error('New Twilio activity: '+p.name);}}
 if(p.channel==='email'){
  if(c.email&&c.email.toLowerCase()!==p.to)throw Error('Email mismatch '+p.name);
  if(c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status))throw Error('Email hold '+p.name);
  const duplicates=await db('market_contacts',{email:'ilike.'+p.to,select:'id,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_status'});
  if(duplicates.some(d=>d.id!==p.id))throw Error('Duplicate email owner '+p.name);
  try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.to}));throw Error('SES suppression '+p.name);}catch(e){if(e.name!=='NotFoundException')throw e;}
 }
 if(p.correctCity&&snapshot.find(r=>r.contact.id===p.id).contact.city!==p.correctCity){await db('market_contacts',{id:'eq.'+p.id,city:'eq.'+c.city},'PATCH',{city:p.correctCity});await db('market_touches',{},'POST',{contact_id:p.id,channel:'sms',direction:'system',created_by:'John — authorized reply fulfilment',notes:'Location correction: '+snapshot.find(r=>r.contact.id===p.id).contact.city+' → '+p.correctCity+'. Partner confirmed most business is in Brant; sending Brant card and answering service coverage.',metadata:{source:'owner_authorized_fulfilment_20260924',source_touch_id:p.source,previous_city:snapshot.find(r=>r.contact.id===p.id).contact.city,corrected_city:p.correctCity}});}
 if(p.channel==='email'&&!c.email)await db('market_contacts',{id:'eq.'+p.id,email:'is.null'},'PATCH',{email:p.to});
 const touchId=randomUUID();const state={state:'reserved_do_not_retry',at:new Date().toISOString(),...p,touchId};
 fs.writeFileSync(receiptPath,JSON.stringify(state,null,2),{flag:'wx'});
 if(p.channel==='sms'){
  const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${p.id}/send-reply`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({body:p.body,from_number:p.from,media_urls:p.media?[p.media]:[]}),signal:AbortSignal.timeout(60000)});
  const result=await r.json();fs.writeFileSync(receiptPath,JSON.stringify({...state,state:r.ok?'provider_accepted':'held',result},null,2));
  if(!r.ok)throw Error('SMS held '+p.name+': '+JSON.stringify(result));console.log(JSON.stringify({name:p.name,channel:p.channel,result}));
 }else{
  await reserveAction({url,headers,contactId:p.id,channel:'email',kind:'reply',key:'owner-fulfilment-20260924:'+p.id,content:p.subject+'\n'+p.body+'\n'+(p.media||''),sender:'John | Saturn Star Movers <john@saturnstarmovers.ca>',emailProvider:'ses'});
  const metadata={source:'owner_authorized_fulfilment_20260924',source_touch_id:p.source,provider:'ses',from:'John | Saturn Star Movers <john@saturnstarmovers.ca>',to:p.to,subject:p.subject,reply_to:'business@starmovers.ca',delivery_state:'reserved',media_urls:p.media?[p.media]:[],owner_fact:p.ownerFact||null};
  await db('market_touches',{},'POST',{id:touchId,contact_id:p.id,channel:'email',direction:'outbound',notes:'Subject: '+p.subject+'\n\n'+p.body+(p.media?'\n[Attached digital card: '+p.media+']':''),created_by:'John — owner-authorized fulfilment',metadata});
  const inbound=snapshot.find(x=>x.contact.id===p.id).touches.find(t=>t.id===p.source);const replyId=inbound?.metadata?.internet_message_id;
  const boundary='saturn_'+createHash('sha256').update(touchId).digest('hex').slice(0,24);
  const lines=['From: John | Saturn Star Movers <john@saturnstarmovers.ca>','To: '+p.to,'Reply-To: business@starmovers.ca','Subject: =?UTF-8?B?'+Buffer.from(p.subject).toString('base64')+'?=','MIME-Version: 1.0'];
  if(replyId&&/^<[^<>\r\n]+>$/.test(replyId))lines.push('In-Reply-To: '+replyId,'References: '+replyId);
  lines.push('Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(p.body).toString('base64').match(/.{1,76}/g).join('\r\n'));
  if(p.media){const r=await fetch(p.media);if(!r.ok)throw Error('Attachment fetch failed');const bytes=Buffer.from(await r.arrayBuffer());lines.push('--'+boundary,'Content-Type: image/jpeg; name="Saturn-Star-Movers-'+p.city+'-card.jpg"','Content-Disposition: attachment; filename="Saturn-Star-Movers-'+p.city+'-card.jpg"','Content-Transfer-Encoding: base64','',bytes.toString('base64').match(/.{1,76}/g).join('\r\n'));}
  lines.push('--'+boundary+'--','');
  const result=await ses.send(new SendEmailCommand({FromEmailAddress:metadata.from,Destination:{ToAddresses:[p.to]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:p.id}],Content:{Raw:{Data:Buffer.from(lines.join('\r\n'))}}}));
  if(!result.MessageId)throw Error('Ambiguous SES response; do not retry');
  fs.writeFileSync(receiptPath,JSON.stringify({...state,state:'provider_accepted',messageId:result.MessageId},null,2));
  await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:result.MessageId},next_step:p.ownerFact?'Await Ryan’s preferred weekend day/time; meeting not booked.':'Requested information fulfilled; await reply.'});
  console.log(JSON.stringify({name:p.name,channel:p.channel,messageId:result.MessageId}));
 }
 await db('market_contacts',{id:'eq.'+p.id},'PATCH',{sequence_paused:true,sequence_paused_reason:p.ownerFact?'Weekend lunch preference sent; awaiting Ryan’s day/time.':'Owner-authorized requested information/reply sent; await partner response.',last_touch_at:new Date().toISOString(),...(p.channel==='email'?{email_last_sent_at:new Date().toISOString()}:{}),next_follow_up:p.ownerFact?'2026-10-01':null});
}
