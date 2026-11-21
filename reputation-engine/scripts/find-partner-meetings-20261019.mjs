import fs from 'node:fs/promises';import {db} from './reply-runtime-20261015.mjs';
const dir='artifacts/partner-meeting-review-20261019';await fs.mkdir(dir,{recursive:true});
const inbound=[];for(let offset=0;;offset+=1000){const p=await db('market_touches',{direction:'eq.inbound',select:'id,contact_id,notes,created_at,channel',order:'created_at.asc,id.asc',limit:'1000',offset:String(offset)});inbound.push(...p);if(p.length<1000)break;}
const re=/exclusiv|logistic|carrier|bulky|transport|\bmeet(?:ing)?\b|coffee|preferred (?:mover|vendor)|ongoing|regular basis|delivery partner|referral basis|staging company/i;
const candidates=inbound.filter(t=>re.test(t.notes||'')&&!/verification verify#|coffee table|nice to meet|pleasure to meet|lovely to meet/i.test(t.notes||''));
const rows=[];for(const id of [...new Set(candidates.map(t=>t.contact_id))]){
 const r=await Promise.allSettled([db('market_contacts',{id:'eq.'+id}),db('market_touches',{contact_id:'eq.'+id,order:'created_at.asc,id.asc',limit:'1000'}),db('crm_tasks',{related_id:'eq.'+id,status:'in.(open,in_progress)'})]);for(const x of r)if(x.status==='rejected')throw x.reason;
 rows.push({contact:r[0].value[0],thread:r[1].value,tasks:r[2].value});
}
await fs.writeFile(dir+'/review.json',JSON.stringify({at:new Date().toISOString(),inbound_count:inbound.length,rows},null,2));
console.log(JSON.stringify({inbound:inbound.length,candidates:rows.length,rows:rows.map(r=>({id:r.contact?.id,name:r.contact?.name,phone:r.contact?.phone,city:r.contact?.city,suppressed:r.contact?.do_not_contact||r.contact?.cross_channel_suppressed_at,matches:r.thread.filter(t=>t.direction==='inbound'&&re.test(t.notes||'')).map(t=>({at:t.created_at,text:t.notes?.slice(0,900)})),latest:r.thread.slice(-3).map(t=>({direction:t.direction,at:t.created_at,text:t.notes?.slice(0,600)}))}))},null,2));
