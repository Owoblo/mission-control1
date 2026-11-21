import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {send,asset,db,reviewed,task}=await import('./reply-runtime-20261015.mjs');
const {rows}=JSON.parse(await fs.readFile('artifacts/partnership-replies-20261015/review.json','utf8'));
for(const name of ['DIANE BOYD','STANLEY LEE','ANANTH PADINJARAYIL KUTTAPPAN','HOLLY GARBY PENNEY','TINA PAPAZIAN']){
 const r=rows.find(r=>r.contact.name===name),c=r.contact,last=r.thread.at(-1),first=c.name.split(' ')[0].toLowerCase().replace(/^./,s=>s.toUpperCase());
 const body=name.startsWith('ANANTH')?"Absolutely, Ananth. Whenever we come across someone looking to buy or sell, we're happy to make an introduction. Here's our digital card to keep handy for clients who need a moving quote. You can call or text me here anytime. - John":`Here you go, ${first}. Here's our ${c.city} digital card to save and share when a client needs a moving quote. You're welcome to call or text me here too. - John`;
 await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261015-1610',body,media_urls:[await asset(c.city)]});
 for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.id!==last.id&&!t.metadata?.partnership_review))await reviewed(t.id,'Fulfilled with the later card request in this conversation.',{});
}
for(const name of ['LEON SCHAUMER','MANNI SAINI','USMAN UL AHSAN','JOHN ROMUALDI','Candice Brennan','DASHMEET BAGGA']){
 const r=rows.find(r=>r.contact.name===name),c=r.contact;
 const latest=(await db('market_touches',{contact_id:'eq.'+c.id,order:'created_at.desc,id.desc',limit:'1'}))[0];if(latest.id!==r.thread.at(-1).id)throw Error('Changed thread '+name);
 const note=name==='JOHN ROMUALDI'?'Retired; no clients. No further recruiting follow-up.':name==='Candice Brennan'?'Referred prospective clients to website/direct number; John already thanked her. Await client contact.':name==='DASHMEET BAGGA'?'John spoke with partner about personal packing/move quote. Owner callback task retained; no duplicate SMS.':'Acknowledgement/reaction to fulfilled card request; no additional reply needed.';
 for(const t of r.thread.filter(t=>t.direction==='inbound'&&!t.metadata?.partnership_review))await reviewed(t.id,note,{});
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});
 if(name==='DASHMEET BAGGA')await task(c,'20261015-dashmeet-personal-move','Call Dashmeet Bagga about his own packing and move quote','Inbound call Oct 15, 3:48pm Eastern: interested in referrals and his personal move, two-bedroom condo (33rd floor) to three-bedroom condo (15th floor) within same block. Needs packing/moving. Phone +14375593233. Confirm date, addresses, inventory and elevators before pricing. John to call back; source call CAa7acff945e4bc835f9049f08a962cd64.',{priority:'high'});
}
const r=rows.find(r=>r.contact.name==='Leo Carnevale'),c=r.contact;
await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:r.thread.at(-1).id,from:r.thread.at(-1).metadata.to,followup_key:'20261015-1610',body:"Thanks for clarifying, Leo. I'll correct our records to Simcoe, Ontario. Appreciate you letting me know. - John"});
await db('market_contacts',{id:'eq.'+c.id},'PATCH',{city:'Simcoe'});
console.log('Five cards and Leo correction sent; acknowledgements reviewed; Dashmeet callback task saved.');
