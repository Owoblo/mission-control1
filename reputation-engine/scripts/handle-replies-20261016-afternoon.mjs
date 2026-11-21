import './gta-email-recovery-runtime.mjs';import fs from 'node:fs/promises';
const{db,send,asset,task}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/reply-review-20261016-afternoon',key='20261016-afternoon';
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json'));
const get=name=>{const r=rows.find(x=>x.contact.name===name);if(!r)throw Error('Missing '+name);return r};
const cards=['PETER LAN CHUNG','Deborah Fernick','JACK J. WANG','MICHAEL BAEUMLER','NADYA KOVALENKO','Terry Annis','SANDEEP LAXMAN KHARAT','KEISHA LONDON','TU MAI','APRIL SUN','KAL TADESSE','Drew Mullett','PETE MACDONALD','JOYCE SUN','VERGIL CHEN','JAVED NOOR','HEIDE HEEMSOTH','Ana Castro','NANCY BRYANT','JASKARAN CHAHAL','MELODY MARTIN','LYUDMILA KOROVKO','Jeanne Hoey'];
const special={
 'TAYLOR KILBURN':{card:true,body:"Here's my digital card, Taylor. We'd be happy to put together a quote for your sellers too. They can call or text me here, or you can introduce us with their permission. What date are they moving, and where are the pickup and destination? - John"},
 'AMIN HIRJI':{card:true,body:"Here's our digital card, Amin. We're bonded and carry $2 million general liability insurance. We've been in business for over seven years. Our website is https://starmovers.ca and Instagram is https://www.instagram.com/saturnstarmovers/. We handle residential and commercial moves, with a flat binding estimate after reviewing the scope. - John"},
 'ZIGGY PISZCZEK':{card:true,body:"Here's our digital card, Ziggy. We quote a flat binding price for the agreed scope, rather than hourly rates. It depends on the furniture and boxes, pickup and destination, stairs or elevators, access and any packing needed. Do you have a particular move in mind, or are you gathering information for future clients? - John"},
 'Gerry Lodwick':{card:true,body:"Here's our digital card, Gerry. For a three-bedroom home about an hour from Lindsay, the furniture and boxes, exact route, stairs or elevators, and packing needs make a big difference. We review those by phone or virtually, then give a flat binding estimate for the agreed scope. Is this a current client's move or an example for future referrals? - John"},
 'RENEE GRIFFITHS':{body:"Thanks for clarifying, Renee. I've noted Prince Edward County. If a client has a move coming up, send me the pickup and destination cities and we can review it. - John"},
 'BLAISE KOH':{body:"We serve Toronto and the GTA, as well as Southwestern Ontario, Blaise. We handle residential and commercial moves. Is there a particular area you need covered for your clients? - John"},
 'EDWARD ANTHONY GLAVAN':{body:"Thanks, Edward. What time on Saturday or Sunday works best for a call? - John"},
 'KAJAN PARAMESHWARANATHAN':{body:"Thanks, Kajan. Are any of those homeowners looking for a moving quote and happy to be introduced to us? We'd be glad to speak with them about the move. - John"},
};
const noReply={
 'PAT HAUER':'Earlier card permission already fulfilled with contextual follow-up after owner call; await client introduction.',
 'CHRISTINE HELEN BURTON':'Earlier card permission already fulfilled alongside website request.',
 'James Lowes':'Uses Two Men and a Truck for clients; not a new moving enquiry. No sales handoff or further chase.',
 'Tammy Anskis':'Declined offer; no further outreach.',
 'HUSSEIN AL-AWADI':'Thanks after card; no reply needed.',
 'CHARMAINE CRUZ':'Thanks after card; no reply needed.',
 'Ola Ananieva':'Will keep information in mind; no current need or card request.',
 'NICOLE KRUZICK':'Explicit STOP; suppress outreach and cancel pending jobs, no reply.',
 'Sandy Dalton':'Explicit no-future-texts request; suppress outreach and cancel pending jobs, no reply.',
 'Vicky Jiang':'Emoji acknowledgement only; no extra message.',
 'Rachel Halcovitch':'Son owns moving company; no sales enquiry or chase.',
 'RICHARD WAYNE JOSEPH HARRIS':'Thanks after card; no reply needed.',
 'NEIL EVERETT':'Declined offer; no further outreach.',
 'John Martino':'Sellify platform suggestion is a business suggestion, not a moving customer. Owner review only; no signup or spend.',
 'TERRY SZWEC':'Rep already replied to corrections. Sales/quote now show October 21 and Etobicoke/Toronto destination. Duplicate intake and inconsistent scope planning require internal correction, not another overlapping customer message.',
 'FIONA JIANG':'Thelma is actively preparing existing Sales quote lead_6s0f1dtsg. Preserve latest truck-and-driver request; internal scope review required, no overlapping quote or new Sales record.',
};
async function latestGuard(r){const[last]=await db('market_touches',{contact_id:'eq.'+r.contact.id,order:'created_at.desc,id.desc',limit:'1'});if(last?.id!==r.thread.at(-1)?.id)throw Error('Changed thread '+r.contact.name);}
async function mark(r,note,receipt={}){for(const t of r.thread.filter(t=>t.direction==='inbound'&&!t.metadata?.partnership_review)){const[cur]=await db('market_touches',{id:'eq.'+t.id});await db('market_touches',{id:'eq.'+t.id},'PATCH',{metadata:{...cur.metadata,partnership_ai:cur.metadata?.partnership_ai?{...cur.metadata.partnership_ai,draft_sms:null,recommended_action:'reviewed',quick_action:'none'}:undefined,partnership_review:{note,reviewed_at:new Date().toISOString(),reply_required:false,...receipt}}});}}
const plan=[...Object.entries(special).map(([name,p])=>({name,...p})),...cards.map(name=>({name,card:true,body:`Here you go, ${name.split(' ')[0].toLowerCase().replace(/^./,c=>c.toUpperCase())}. Here's our digital card to save and share with clients. We handle residential and commercial moves, and you can call or text me here. - John`}))];
await fs.writeFile(dir+'/plan.json',JSON.stringify({plan,noReply},null,2));
if(!process.argv.includes('--apply')){console.log(JSON.stringify({sends:plan.length,cards:plan.filter(p=>p.card).length,noReply:Object.keys(noReply).length}));process.exit(0);}
const results=[];
for(const name of ['NICOLE KRUZICK','Sandy Dalton']){const r=get(name);await latestGuard(r);await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{do_not_contact:true,cross_channel_suppressed_at:new Date().toISOString(),cross_channel_suppression_reason:'recipient_explicit_stop_20261016',sequence_paused:true,sequence_paused_reason:'recipient_opt_out',next_follow_up:null,stage:'dnc',decision:'opted_out'});await db('sequence_jobs',{contact_id:'eq.'+r.contact.id,status:'eq.pending'},'PATCH',{status:'cancelled',error:'Recipient requested no further contact'});await mark(r,noReply[name]);results.push({name,state:'recipient_opt_out_honored'});}
for(const p of plan){try{const r=get(p.name),c=r.contact;await latestGuard(r);if(p.name==='RENEE GRIFFITHS')await db('market_contacts',{id:'eq.'+c.id},'PATCH',{city:'Prince Edward County'});
 const receipt=await send({id:c.id,name:c.name,phone:c.phone,city:p.name==='RENEE GRIFFITHS'?'Prince Edward County':c.city,latest:r.thread.at(-1).id,from:'+14374650584',body:p.body,followup_key:key,...(p.card?{media_urls:[await asset(c.city)]}:{})});
 if(receipt.state!=='accepted')throw Error('No verified acceptance');await mark(r,'Contextual reply fulfilled; no automatic chase.',{provider_receipt:receipt.result?.sid});
 results.push({name:p.name,state:receipt.state,sid:receipt.result?.sid,card:!!p.card});console.log(JSON.stringify(results.at(-1)));
 }catch(e){results.push({name:p.name,error:e.message});console.error(p.name,e.message);}}
for(const[name,note]of Object.entries(noReply).filter(([n])=>!['NICOLE KRUZICK','Sandy Dalton'].includes(n))){try{const r=get(name);await latestGuard(r);await mark(r,note);await db('market_contacts',{id:'eq.'+r.contact.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});results.push({name,state:'reviewed_no_reply'});}catch(e){results.push({name,error:e.message});}}
for(const[name,title,description,due]of [
 ['EDWARD ANTHONY GLAVAN','John: arrange Edward weekend call','Edward requested a weekend call. Asked preferred Saturday/Sunday time; none agreed. Check reply and John availability before confirming.','2026-10-17T14:00:00Z'],
 ['John Martino','John: review Sellify suggestion','John Martino says Sellify launches October 26 and suggests a free business profile. Unverified marketing suggestion, not a customer lead; no signup, payment or commitment made.',null],
 ['HEIDE HEEMSOTH','John: check Heide short incoming call','Heide requested digital card. An 8-second recording transcript contains only “Spaceship noises”; generated claims about pricing/availability are unsupported. Do not count as a moving opportunity. Card sent; review/return short call if needed.',null],
 ]){const r=get(name);await task(r.contact,key+'-'+r.contact.id,title,description,{...(due?{due_at:due}:{})});}
await fs.writeFile(dir+'/results.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify({accepted:results.filter(x=>x.state==='accepted').length,errors:results.filter(x=>x.error)}));
