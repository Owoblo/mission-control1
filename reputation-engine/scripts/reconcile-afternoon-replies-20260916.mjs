import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root='partnership-system/state/replies-afternoon-20260916';
const snapshot=JSON.parse(await fs.readFile('partnership-system/state/reply-actions-20260916-preflight.json'));
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(t,q={},method='GET',body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status);return r.status===204?[]:r.json();}
const actions={
 'Ali Abbas':['Await Ali’s response about commercial property types. He reports recommending Dexa, not a confirmed booking. No automatic follow-up.',null],
 'Michelle Donaldson-Rouleau':['Reconnect in October to arrange a mutually agreed time. No September outreach; no appointment confirmed.','2026-10-01T13:00:00Z'],
 'Chris A. Brown':['Dr. Courage to check September 29 around noon availability and confirm with Chris. Offered time only; acknowledgement sent.','2026-09-17T13:00:00Z'],
 'David Mcdonnell':['David accepted the previously offered September 22 at 10 a.m. Office address requested. John must finalize logistics and fulfil this previously missed visit; owner availability question pending.','2026-09-17T13:00:00Z'],
 'Bryan Hummel':['Digital card sent by requested SMS/MMS. Verify delivery; no duplicate card.',null],
 'Sebastien Sezlik':['Requested card link emailed from hello@dexamovers.ca. Provider accepted; delivery not established. Verify receipt without resending.','2026-09-17T13:00:00Z'],
 'Mehdi Fallahi':['Requested digital information emailed from hello@dexamovers.ca. Provider accepted; delivery not established. Verify receipt without resending.','2026-09-17T13:00:00Z'],
 'Campers Cove Campground — Business contact':['No current moving need. Staff offered to pass details to owners; thank-you sent. Await inbound; no automatic follow-up.',null],
};
const results=[];
for(const old of snapshot){
 const c=old.contact;let receipt;try{receipt=JSON.parse(await fs.readFile(root+'/'+c.id+'.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}if(receipt.state!=='accepted')continue;
 const key='afternoon-reply-review-20260916:'+c.id;
 const [action,due]=actions[c.name];
 const [latest]=await db('market_touches',{contact_id:'eq.'+c.id,direction:'eq.inbound',order:'created_at.desc',limit:'1'});
 if(latest.id!==receipt.sourceTouch){results.push({name:c.name,held:'new inbound requires review'});continue;}
 await db('market_contacts',{id:'eq.'+c.id},'PATCH',{sequence_paused:true,sequence_paused_reason:action,next_follow_up:c.name==='Michelle Donaldson-Rouleau'?'2026-10-01':null,...(receipt.email?{preferred_channel:'email'}:{})});
 const tasks=await db('crm_tasks',{related_id:'eq.'+c.id,status:'in.(open,in_progress)'});
 if(due){
  if(tasks.length){for(const task of tasks){if(task.description?.includes(key))continue;await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{due_at:due,priority:'high',description:JSON.stringify({review_key:key,next_action:action,source_touch:receipt.sourceTouch,send_receipt:receipt.result.sid||receipt.result.messageId,previous_description:task.description})});}}
  else await db('crm_tasks',{on_conflict:'source_key'},'POST',{id:randomUUID(),title:c.name+': '+(c.name==='Michelle Donaldson-Rouleau'?'October follow-up':'partnership follow-through'),description:JSON.stringify({review_key:key,next_action:action,source_touch:receipt.sourceTouch,send_receipt:receipt.result.sid||receipt.result.messageId}),status:'open',priority:'high',category:'partnership',due_at:due,owner_name:c.owner_name||'John',owner_user_id:c.assigned_manager_user_id||null,related_type:'relationship',related_id:c.id,related_label:c.name,source:'manual',source_key:key,created_by_name:'John — reviewed replies'});
 }else if(c.name.startsWith('Campers Cove')){for(const task of tasks)await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{status:'completed',completed_at:new Date().toISOString(),completed_by_name:'John — reviewed replies',outcome_note:action});}
 if(c.name==='Michelle Donaldson-Rouleau'){
  const account=c.partner_company_id;if(!account)throw Error('Missing Michelle account');
  const [prior]=await db('partnership_account_policy',{account_id:'eq.'+account});
  const wait='2026-10-01T13:00:00Z';const next={not_before:prior?.not_before&&Date.parse(prior.not_before)>Date.parse(wait)?prior.not_before:wait,evidence_ref:'market_touches:'+receipt.sourceTouch,updated_at:new Date().toISOString()};
  await db('partnership_account_policy',prior?{account_id:'eq.'+account}:{},prior?'PATCH':'POST',prior?next:{account_id:account,...next});
  const pending=await db('sequence_jobs',{contact_id:'eq.'+c.id,status:'eq.pending',select:'id,scheduled_at,channel'});
  results.push({name:c.name,pendingJobs:pending});
 }
 results.push({name:c.name,action,due});
}
for(const id of ['93bdb53b-2471-4532-b217-1d21a1d3f223','809339b1-9b70-4413-aa98-d88d004ba0e2']){
 const [t]=await db('market_touches',{id:'eq.'+id});if(!t||!t.notes.startsWith('Inbound SMS: Liked “'))throw Error('Reaction evidence mismatch');
 if(t.metadata?.afternoon_reaction_review)continue;
 await db('market_touches',{id:'eq.'+id},'PATCH',{outcome_code:'warm_acknowledgement',next_step:'Reaction to an existing message; no new time window or card request. Do not duplicate outreach.',metadata:{...t.metadata,afternoon_reaction_review:true,previous_outcome_code:t.outcome_code,classification_reviewed_at:new Date().toISOString()}});
}
await fs.writeFile(root+'/reconciliation.json',JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
