import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {send,asset,reviewed,db}=await import('./reply-runtime-20261007.mjs');
const rows=JSON.parse(await fs.readFile('artifacts/realtor-batch-20261010/reply-review.json','utf8'));
const cards=new Set(['ROMEL HARRIPERSAUD','NAZ BEHJAT','SAL ZAPPULLA','TENNEIL HOLLENBECK','PANTEA SAHEBDIVANI','THEEPAN GNANASABAPATHY','SAHIRA PEREZ-VELA']);
const receipts=[];
for(const {contact:c,thread} of rows){
 const first=c.name.split(' ')[0].toLowerCase().replace(/^./,x=>x.toUpperCase());
 if(cards.has(c.name)||c.name==='SHARA ANSARI'){
 const card=cards.has(c.name);
 receipts.push(await send({id:c.id,name:c.name,phone:c.phone,city:c.city,latest:thread.at(-1).id,from:'+14374650584',followup_key:'20261010-replies-1000',body:card?`Thanks, ${first}! Here is our digital card to keep handy and share whenever a client needs a moving quote. Happy to help. - John`:`Hi Shara, pricing depends on what needs moving, the pickup and drop-off locations, floors and access, and any packing. We provide a flat binding estimate once the scope is confirmed, so the price for the agreed work is clear upfront. Is there a particular move you or a client need quoted? - John`,media_urls:card?[await asset(c.city)]:[]}));
 }else if(['VARUN ARORA','MARYAM MASHREGHI-MOHAMMADI'].includes(c.name)){
 for(const t of thread.filter(t=>t.direction==='inbound'&&t.created_at>='2026-10-10T12:25:00'))await reviewed(t.id,'Acknowledgement or image reaction; existing card received. No further reply required. No live move inferred.',{});
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'human_managed_relationship',next_follow_up:null});
 }
}
await fs.writeFile('artifacts/realtor-batch-20261010/reply-results-1000.json',JSON.stringify(receipts,null,2));
