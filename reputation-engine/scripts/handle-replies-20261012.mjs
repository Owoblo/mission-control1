import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db,send,asset,reviewed}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/partnership-replies-20261012';
const {rows}=JSON.parse(await fs.readFile(dir+'/review.json','utf8'));
const plans=[];
for(const r of rows){const c=r.contact,last=r.thread.at(-1);const p={id:c.id,name:c.name,phone:c.phone,city:c.city,latest:last.id,from:last.metadata.to,followup_key:'20261012-morning'};
 if(c.name==='ALEXEI ANTSYFEROV'){
  p.body="Happy Thanksgiving, Alexei! Thanks for sending the videos over. We'll review these for your November 26 move and come back with any essential details we still need. I've noted that you'd ideally like the estimate by tomorrow at 10am so you can compare both options. - John";
  p.note='New videos acknowledged; quote preparation remains open with John. Requested deadline October 13 10am Toronto, not a promised delivery or booked visit.';
 }else if(['CHAUDHRY DANISH','LEENA NAVEED'].includes(c.name)){
  const first=c.name==='CHAUDHRY DANISH'?'Chaudhry':'Leena';p.body=`Here you go, ${first}! Here's our ${c.city} digital card to save and share whenever a client needs a moving quote. Happy Thanksgiving! - John`;p.media_urls=[await asset(c.city)];
 }else if(c.name==='ARLENE MARQUES')p.body='Thank you, Arlene! Happy Thanksgiving to you too. - John';
 else continue;
 plans.push(p);
}
await fs.writeFile(dir+'/send-plan.json',JSON.stringify(plans,null,2));
const results=[];
for(const p of plans){try{const r=await send(p);results.push({name:p.name,...r});}catch(e){results.push({name:p.name,error:e.message});console.log(JSON.stringify({name:p.name,error:e.message}));}}
await fs.writeFile(dir+'/send-results.json',JSON.stringify(results,null,2));
const alex=rows.find(r=>r.contact.name==='ALEXEI ANTSYFEROV');const clips=alex.thread.filter(t=>t.direction==='inbound'&&t.created_at>'2026-10-12'&&t.notes?.includes('[MMS:')).map(t=>({touchId:t.id,url:t.notes.match(/\[MMS: (https:\/\/[^\]]+)\]/)[1]}));
await fs.writeFile(dir+'/alexei-video-links.json',JSON.stringify(clips,null,2));
const [task]=await db('crm_tasks',{id:'eq.owner-20261011-alexei-estimate'});
if(task){const marker='October 12: Alexei re-engaged';const add=`${marker} with four video attachments showing what needs to move. He asks whether a quote can be based on them and would ideally like it by Tuesday October 13 at 10am Toronto, to compare both options. Review videos first; staging exclusions and missing scope still need verification. Do not resend the long inventory questionnaire. This is a requested estimate deadline, not a confirmed visit or promised quote. Email alex@aaproperties.ca.\n${clips.map(c=>c.url).join('\n')}`;await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{title:'Alexei: review videos and prepare November 26 estimate',due_at:'2026-10-13T14:00:00Z',priority:'high',status:'open',description:task.description.includes(marker)?task.description:task.description+'\n\n'+add});}
for(const r of rows){const receipt=results.find(x=>x.name===r.contact.name&&x.state==='accepted');for(const t of r.thread.filter(t=>t.direction==='inbound'&&t.created_at>'2026-10-11T21:40:49Z')){
 if(r.contact.name==='ALEXEI ANTSYFEROV'&&!receipt)continue;
 if(!receipt&&r.contact.name!=='Maham Naveed')continue;
 const note=r.contact.name==='ALEXEI ANTSYFEROV'?'Re-engaged with videos and requested October 13 10am estimate. Acknowledged; quote review remains open with John.':r.contact.name==='Maham Naveed'?'Reaction to delivered card; no new request or reply needed.':r.contact.name==='ARLENE MARQUES'?'Thanksgiving greeting acknowledged once; duplicated inbound text is not a second request.':'Requested city digital card sent.';
 await reviewed(t.id,note,receipt?{provider_receipt:receipt.result.sid}:{});
 const [current]=await db('market_touches',{id:'eq.'+t.id});await db('market_touches',{id:'eq.'+t.id},'PATCH',{metadata:{...current.metadata,partnership_ai:{...current.metadata?.partnership_ai,draft_sms:'',recommended_action:r.contact.name==='ALEXEI ANTSYFEROV'?'human_review':'no_reply',rationale:note}},next_step:r.contact.name==='ALEXEI ANTSYFEROV'?'John: review supplied videos and prepare estimate; requested by October 13 10am Toronto.':'Reviewed; no additional SMS needed.'});
}}
const verification=[];for(const r of results.filter(r=>r.state==='accepted')){const touches=await db('market_touches',{contact_id:'eq.'+r.plan.id,direction:'eq.outbound',order:'created_at.desc',limit:'10'});const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+r.result.sid.replace('telnyx:',''),select:'status,occurred_at',order:'occurred_at.desc',limit:'10'});verification.push({name:r.name,sid:r.result.sid,crmReceipts:touches.filter(t=>t.metadata?.twilioSid===r.result.sid).length,events});}
await fs.writeFile(dir+'/verification.json',JSON.stringify(verification,null,2));console.log(JSON.stringify({verification,videoAttachments:clips.length}));
