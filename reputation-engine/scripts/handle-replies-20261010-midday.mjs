import './gta-email-recovery-runtime.mjs';import fs from 'node:fs/promises';const {send,asset,reviewed,db}=await import('./reply-runtime-20261007.mjs');
const {out}=JSON.parse(await fs.readFile('artifacts/realtor-batch-20261010/reply-check-current.json','utf8'));
const cards=new Set(['SAMIR MEHTA','ANGELA LI KUAN WANG','DANIEL LIN','JULIE LYNN ROBERT','ROOPAN THAMBIRAJAH','TANJEEM RAHMAN','RAJAN ACHARYA','Arunn Arora']);
const texts={'JOSEPH DAVID WARD':"Thanks for clarifying, Joseph. We also help with office and small commercial moves, so happy to be a resource if that comes up for your clients. - John",'VICTORIA BOMBEN':"Hi Victoria, I think that message may have been meant for someone else. This is John with Saturn Star Movers, reaching out about moving referrals. No worries!"};let results=[];
for(const {contact:c,thread} of out){const card=cards.has(c.name);if(card||texts[c.name]){const first=c.name.split(' ')[0].toLowerCase().replace(/^./,s=>s.toUpperCase());const receipt=await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:thread[0].id,from:thread[0].metadata.from===c.phone?thread[0].metadata.to:thread[0].metadata.from,followup_key:'20261010-midday',body:card?`Here you go, ${first}! Here's our ${c.city} digital card to save and share whenever a client needs a moving quote. Happy to help. - John`:texts[c.name],media_urls:card?[await asset(c.city)]:[]});results.push(receipt);
 for(const t of thread.filter(t=>t.direction==='inbound'&&!t.metadata.review&&t.created_at>='2026-10-10T04:00:00Z'))await reviewed(t.id,c.name==='TANJEEM RAHMAN'?'Coverage answered by John; requested Vaughan card now sent.':'Context reviewed and reply sent.',{provider_receipt:receipt.result.sid});
 }else{for(const t of thread.filter(t=>t.direction==='inbound'&&!t.metadata.review&&t.created_at>='2026-10-10T04:00:00Z')){
 let note='Acknowledgement reviewed; no additional message required. No live move inferred.';
 if(c.name==='KOVIA LOVELL')note='John already replied at 14:34Z. Own Brampton-to-storage move; house rented November 1, move date not confirmed. Avoid duplicate follow-up.';
 if(c.name==='RAYISSA PALMER')note='Owner already responded in the thread at 15:26Z; no additional assistant message.';
 if(c.name==='Charlene Longlade')note=t.notes.includes('napkins')?'Historical request reviewed; food receipt subsequently confirmed, but napkins/bag fulfilment not verified.':'Recipient confirmed food received in response to John. Digital card previously sent. No extra message needed.';
 await reviewed(t.id,note,{});
 }await db('market_contacts',{id:'eq.'+c.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});}
}
await fs.writeFile('artifacts/realtor-batch-20261010/reply-results-midday.json',JSON.stringify(results,null,2));
