import fs from 'node:fs/promises';
import {send,asset,db,task,reviewed} from './reply-runtime-20261015.mjs';
const dir='artifacts/reply-review-20261019-weekend';
const context=JSON.parse(await fs.readFile(dir+'/latest-reply-check.json')).rows;
const targets=[['ed168b47-6826-41d9-b25a-e3d4c1ba444a','Traci'],['eebd3307-5e1a-4fd9-a414-116e4d3ff6a6','Shervin'],['e13dfdc9-e564-4e11-98ff-4c36357999cd','Toni-Lynn'],['d740f24c-e053-40d3-aa0f-2e25d44e1038','Jason'],['ef7395eb-4a49-415a-8a9e-d517e5072ae4','Diane'],['eca1ebc3-f1a4-4a45-a601-06662e0b6a91','Mahmoud']];
const plans=[];
for(const [id,first] of targets){
 const r=context.find(x=>x.contact.id===id);if(!r)throw Error('Missing reviewed context');const c=r.contact;
 let body=`Here you go, ${first}. Here's our ${c.city} digital card to save and share when a client needs moving help. You can call or text me here. - John`;
 if(first==='Diane')body="Thanks for sharing your card, Diane. Here's our Hamilton digital card for your clients who need moving help. You can call or text me here. - John";
 if(first==='Toni-Lynn')body="Absolutely, Toni-Lynn, I'd be happy to discuss working together on referrals. Here's our Vaughan digital card. What kind of referral arrangement did you have in mind? - John";
 plans.push({id,name:c.name,phone:c.phone,city:c.city,latest:r.thread[0].id,from:'+14374650584',body,media_urls:[await asset(c.city)],followup_key:'20261019-six-followon',note:'Owner explicitly authorized these six replies. Requested city card and contextual response sent; no referral fees, terms or booking promised.'});
}
await fs.writeFile(dir+'/six-followon-drafts.json',JSON.stringify(plans,null,2));
const results=[];
for(const p of plans){
 try{
  const receipt=await send(p);if(receipt.state!=='accepted')throw Error('Receipt needs reconciliation');
  const sid=receipt.result.sid;
  const touches=await db('market_touches',{'metadata->>twilioSid':'eq.'+sid,direction:'eq.outbound'});
  if(touches.length!==1)throw Error('CRM receipt mismatch');
  const row=context.find(r=>r.contact.id===p.id);
  for(const t of row.thread.filter(t=>t.direction==='inbound'&&t.id!==p.latest&&!t.metadata?.partnership_review))await reviewed(t.id,p.note,{provider_receipt:sid,fulfilled_by_touch_id:touches[0].id});
  if(p.id==='e13dfdc9-e564-4e11-98ff-4c36357999cd')await task(row.contact,'20261019-toni-lynn-referral','Review Toni-Lynn referral arrangement when she responds','Toni-Lynn asked about working together on a referral basis. Sent Vaughan card and asked what arrangement she has in mind. No fee, agreement or moving job established. Await her response; do not automatically chase.');
  results.push({name:p.name,state:'accepted',sid,card:true,crm_touch:touches[0].id});
 }catch(e){results.push({name:p.name,state:'held_or_needs_review',reason:String(e)});}
 await fs.writeFile(dir+'/six-followon-results.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
}
console.log(JSON.stringify(results));
