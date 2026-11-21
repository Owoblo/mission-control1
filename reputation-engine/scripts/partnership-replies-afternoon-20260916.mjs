import fs from 'node:fs/promises';
import {createHmac} from 'node:crypto';
const apply=process.argv.includes('--apply');
const root='partnership-system/state/replies-afternoon-20260916';
await fs.mkdir(root,{recursive:true});
const snapshot=JSON.parse(await fs.readFile('partnership-system/state/reply-actions-20260916-preflight.json'));
const card='https://idbyrtwdeeruiutoukct.supabase.co/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-16-dexa/ottawa/card.jpg';
const plans=[
 {name:'David Mcdonnell',body:"Thanks David, I appreciate you making time on Tuesday, September 22 at 10. Could you confirm the office address so I can finalize the visit details? — John"},
 {name:'Ali Abbas',body:"Good to hear from you, brother, and thanks for checking in! I really appreciate you recommending us. No need to chase clients about which mover they chose. Great to hear you've been doing lots of commercial deals too. Are those mainly office spaces, retail, or another type of property? — Courage"},
 {name:'Michelle Donaldson-Rouleau',body:"Absolutely, Michelle—let's pick this up in October. I'll reach out then so we can find a time that suits you. Hope the next couple of weeks go smoothly! — Dr. Courage"},
 {name:'Chris A. Brown',body:"Thanks Chris! I've noted September 29 around noon. Let me check my availability and get back to you before we lock it in. I appreciate you making time. — Dr. Courage"},
 {name:'Bryan Hummel',body:"Here you go, Bryan! Here's our Dexa Movers card to keep handy or pass along. Clients can reach our Ottawa team at 613-519-3236. Thanks! — Dr. Courage",media_urls:[card]},
 {name:'Sebastien Sezlik',email:'sebastien@sezlik.com',sender:'courage',subject:'Your Dexa Movers digital card',body:`Hi Sebastien,\n\nThanks for your message. Here's the Dexa Movers digital card you requested:\n${card}\n\nYou can save it and share it with clients planning a move in Ottawa and surrounding areas. Our Ottawa team can be reached at 613-519-3236.\n\nThank you,\nDr. Courage\nDexa Movers\nhello@dexamovers.ca\ndexamovers.ca`},
 {name:'Mehdi Fallahi',email:'yes@realottawa.ca',sender:'courage',subject:'Dexa Movers information for your team',body:`Hi Mehdi,\n\nThanks for sharing your email. Here's our digital card for you and your team to keep or pass along:\n${card}\n\nWe help with home, apartment and office moves in Ottawa and surrounding areas. Clients can reach our Ottawa team at 613-519-3236 to discuss their move.\n\nThank you,\nDr. Courage\nDexa Movers\nhello@dexamovers.ca\ndexamovers.ca`},
 {name:'Campers Cove Campground — Business contact',email:'info@camperscove.ca',sender:'john',subject:'RE: Moving support for your team',body:"Hi,\n\nThank you for passing my details along to the owners—I appreciate it. Understood that there's no moving need at the moment. If something comes up, they're welcome to get in touch.\n\nJohn Owolabi\nSaturn Star Movers\nbusiness@starmovers.ca | (226) 773-2993\nstarmovers.ca\n3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4"},
];
const clean=s=>String(s||'').replace(/\\r|\\n|\r|\n/g,'').trim();
const headers={apikey:clean(process.env.SUPABASE_KEY),Authorization:'Bearer '+clean(process.env.SUPABASE_KEY),'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,q={},method='GET',body){const r=await fetch(clean(process.env.SUPABASE_URL)+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(table+' '+r.status);return r.status===204?[]:r.json();}
const secret=clean(process.env.AUTH_SECRET);if(!secret||secret.includes('SENSITIVE'))throw Error('Missing auth');
const p=Buffer.from(JSON.stringify({role:'owner',name:'John — reviewed partnership replies',exp:Date.now()+900000})).toString('base64url');
const cookie='mc_session='+p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
for(const plan of plans){
 const old=snapshot.find(r=>r.contact.name===plan.name);const id=old.contact.id;
 const source=old.touches.filter(t=>t.direction==='inbound').at(-1);
 const path=root+'/'+id+'.json';
 try{await fs.access(path);console.log(plan.name+': prior attempt; inspect receipt, no retry');continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const [latest]=await db('market_touches',{contact_id:'eq.'+id,direction:'eq.inbound',order:'created_at.desc',limit:'1'});
 if(latest?.id!==source.id){console.log(plan.name+': new reply, held');continue;}
 const after=await db('market_touches',{contact_id:'eq.'+id,direction:'eq.outbound',created_at:'gt.'+source.created_at});
 if(after.some(t=>!t.notes?.startsWith('SES event: '))){console.log(plan.name+': already answered, held');continue;}
 const [contact]=await db('market_contacts',{id:'eq.'+id});
 if(contact.do_not_contact||contact.cross_channel_suppressed_at||contact.email_unsubscribed_at)throw Error('Suppressed '+plan.name);
 if(!plan.email){
  const sid=clean(process.env.TWILIO_ACCOUNT_SID),token=clean(process.env.TWILIO_AUTH_TOKEN);
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?`+new URLSearchParams({To:contact.phone,PageSize:'20'}),{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});
  if(!r.ok)throw Error('Provider history '+r.status);
  const messages=(await r.json()).messages;
  if(messages.some(m=>m.direction.startsWith('outbound')&&Date.parse(m.date_created)>Date.parse(source.created_at))){console.log(plan.name+': newer provider outbound, held');continue;}
 }
 if(!apply){console.log(JSON.stringify({name:plan.name,source:source.id,...plan}));continue;}
 if(plan.email&&contact.email!==plan.email){
  if(contact.email||!source.notes.includes(plan.email))throw Error('Recipient evidence mismatch');
  await db('market_contacts',{id:'eq.'+id,email:'is.null'},'PATCH',{email:plan.email,email_source:'contact_provided_in_conversation',email_verification_status:'conversation_provided',email_verification_reason:'Recipient requested this email route in touch '+source.id+'; not SMTP-verified'});
 }
 await fs.writeFile(path,JSON.stringify({state:'reserved_no_retry',contactId:id,sourceTouch:source.id,...plan},null,2),{flag:'wx'});
 const payload=plan.email?{sender:plan.sender,subject:plan.subject,body:plan.body}:{body:plan.body,...(contact.city==='Ottawa'?{from_number:'+15482908695'}:{}),media_urls:plan.media_urls||[]};
 const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${id}/${plan.email?'send-email':'send-reply'}`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
 const result=await r.json();await fs.writeFile(path,JSON.stringify({state:r.ok?'accepted':'held',at:new Date().toISOString(),contactId:id,sourceTouch:source.id,...plan,http:r.status,result},null,2));
 console.log(JSON.stringify({name:plan.name,http:r.status,sid:result.sid,messageId:result.messageId,error:result.error}));
}
