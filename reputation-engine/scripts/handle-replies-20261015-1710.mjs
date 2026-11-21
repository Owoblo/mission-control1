import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {send,asset,db,reviewed,task}=await import('./reply-runtime-20261015.mjs');
const {rows}=JSON.parse(await fs.readFile('artifacts/partnership-replies-20261015/review.json','utf8'));
const custom={
'BESSIE MARIEL REGO-SANCHEZ':"Here you go, Bessie. We handle residential and commercial moves across the GTA and surrounding areas. Pricing depends on the inventory, distance, floors/access and any packing needed. We provide a flat binding estimate after confirming the scope. Is there a particular move you have in mind? - John",
'Suzanne Tavares':"Here's our digital card, Suzanne. For pricing, we provide a flat binding estimate once we've confirmed the inventory, pickup/drop-off, floors/access and any packing needed. A general rate sheet wouldn't give your clients an accurate quote for their move. You're welcome to send them our number and we'll work through the details with them. - John",
'SKY MORIYAMA':"Here's our digital card, Sky. We'd be happy to discuss a referral arrangement with you and agree the terms before any referral, including what works with your brokerage. What would be a good time for a quick call? - John"
};
const names=['BESSIE MARIEL REGO-SANCHEZ','Adrian Andronic','Suzanne Tavares','SKY MORIYAMA','PARINAZ SADEGHIAN RIZI','RYAN STEVE DEHANEY','AJIT DUDANI','INA ERCULJ','KAREN SANDRA NOLAN'];
for(const name of names){const r=rows.find(r=>r.contact.name===name),c=r.contact,last=r.thread.at(-1),first=name.split(' ')[0].toLowerCase().replace(/^./,s=>s.toUpperCase());
await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-1710',body:custom[name]||`Here you go, ${first}. Here's our ${c.city} digital card to keep handy and share whenever a client needs a moving quote. You can call or text me here too. - John`,media_urls:[await asset(c.city)]});
for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==last.id&&!t.metadata?.partnership_review))await reviewed(t.id,'Handled with the later request in this conversation.',{});
if(name==='SKY MORIYAMA')await task(c,'20261015-sky-referral-terms','Discuss referral arrangement with Sky Moriyama','Sky frequently receives requests for mover recommendations and asked about referral compensation. Card sent and convenient call time requested. Agree owner-approved terms; no amount promised.');}
const d=rows.find(r=>r.contact.name==='DIANE BOYD'),c=d.contact;
await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:d.thread.at(-1).id,from:d.thread.at(-1).metadata.to,followup_key:'20261015-1710',body:"We cover the GTA and surrounding areas too, Diane, including Toronto, Mississauga, Vaughan, Markham, Oakville, Burlington and Hamilton. We handle both residential and commercial moves. Where does your client need help moving? - John"});
for(const name of ['NEELU SIDHU','GAGANH NARULA','Leo Carnevale','POOJA SETH']){
const r=rows.find(r=>r.contact.name===name),c=r.contact;const [latest]=await db('market_touches',{contact_id:'eq.'+c.id,order:'created_at.desc,id.desc',limit:'1'});if(latest.id!==r.thread.at(-1).id)throw Error('Changed thread '+name);
if(name==='POOJA SETH')await task(c,'20261015-pooja-personal-move','Arrange quote callback for Pooja Seth — Halton Hills move','Pooja called Oct 15 around 5:05pm about her own move: one bedroom worth of boxes/items from storage to detached home, Halton Hills to Halton Hills. Tentative next Thursday/Friday (Oct 22/23); confirm exact date, inventory, addresses and access. Call +14164204743. Call CA35c801f3b52ddf879b95e1e406eb11c2. John promised a service representative callback for a scope-based flat quote. Interested in future client referrals too; no booking or price confirmed.',{priority:'high'});
for(const t of r.thread.filter(t=>t.direction==='inbound'&&!t.metadata?.partnership_review))await reviewed(t.id,name==='POOJA SETH'?'Owner call reviewed; quote callback task saved. No duplicate introductory SMS.':'Acknowledgement of fulfilled request; no further reply needed.',{});
await db('market_contacts',{id:'eq.'+c.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});}
console.log('Nine cards and one coverage answer accepted; Pooja and Sky tasks recorded.');
