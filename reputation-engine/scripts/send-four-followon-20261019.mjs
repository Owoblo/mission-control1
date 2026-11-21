import fs from 'node:fs/promises';
import {send,asset,db} from './reply-runtime-20261015.mjs';
const dir='artifacts/reply-review-20261019-weekend';
const context=JSON.parse(await fs.readFile(dir+'/new-thread-context.json'));
const targets=[['ecb2e423-081f-4923-83da-a29b5e7e2bd2','Joy'],['e6108e16-11bb-4ae1-8505-de0074eead4a','Daniel'],['ea834c8e-ce0c-4cd7-b3e2-e92f64588fc5','Sheikan'],['e98edb7a-de34-4920-bb60-ae5bd1a38e7d','Philip']];
const plans=[];
for(const [id,first] of targets){
 const r=context.find(x=>x.contact.id===id),c=r.contact;
 const body=first==='Philip'?"Hi Philip, we serve Newmarket and the wider GTA as well as the London area. The introduction was about our moving service coverage. Thanks for keeping my number handy. - John":`Here you go, ${first}. Here's our ${c.city} digital card to save and share when a client needs moving help. You can call or text me here. - John`;
 plans.push({id,name:c.name,phone:c.phone,city:c.city,latest:r.thread[0].id,from:'+14374650584',body,media_urls:first==='Philip'?[]:[await asset(c.city)],followup_key:'20261019-four-followon',note:'Owner explicitly authorized these four follow-on replies. Requested card or coverage clarification fulfilled; no automatic chase.'});
}
await fs.writeFile(dir+'/four-followon-drafts.json',JSON.stringify(plans,null,2));
const results=[];
for(const p of plans){
 try{
  const receipt=await send(p);
  if(receipt.state!=='accepted')throw Error('Receipt needs reconciliation');
  const sid=receipt.result.sid;
  const touches=await db('market_touches',{'metadata->>twilioSid':'eq.'+sid,direction:'eq.outbound'});
  if(touches.length!==1)throw Error('CRM receipt mismatch');
  results.push({name:p.name,state:'accepted',sid,card:p.media_urls.length>0,crm_touch:touches[0].id});
 }catch(e){results.push({name:p.name,state:'held',reason:String(e)});}
 await fs.writeFile(dir+'/four-followon-results.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
}
console.log(JSON.stringify(results));
