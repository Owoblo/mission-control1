import fs from 'node:fs/promises';
import {db} from './reply-runtime-20261015.mjs';
const dir='artifacts/reply-review-20261019-weekend';
const since='2026-10-19T16:39:40Z';
const query={direction:'eq.inbound',created_at:'gte.'+since,order:'created_at.asc',limit:'1000'};
const checks=await Promise.allSettled([db('market_touches',query),db('sms_messages',query)]);
for(const r of checks)if(r.status==='rejected')throw r.reason;
const [inbound,sms]=checks.map(r=>r.value);if(inbound.length===1000||sms.length===1000)throw Error('Pagination needed');
const rows=[];
for(const id of [...new Set(inbound.map(t=>t.contact_id))]){
 const [contacts,thread]=await Promise.all([db('market_contacts',{id:'eq.'+id}),db('market_touches',{contact_id:'eq.'+id,order:'created_at.desc,id.desc',limit:'12'})]);
 rows.push({contact:contacts[0],thread});
}
const four=JSON.parse(await fs.readFile(dir+'/four-followon-results.json')).results;
const ids=four.map(r=>r.sid.replace('telnyx:',''));
const events=await db('crm_sms_provider_events',{provider_message_id:'in.('+ids.join(',')+')',event_type:'eq.message.finalized',order:'occurred_at.desc'});
const result={at:new Date().toISOString(),since,inbound,rows,sms,four_delivery:four.map(r=>({name:r.name,status:events.find(e=>e.provider_message_id===r.sid.replace('telnyx:',''))?.status||'awaiting_final_receipt'}))};
await fs.writeFile(dir+'/latest-reply-check.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,rows:rows.map(r=>({id:r.contact.id,name:r.contact.name,city:r.contact.city,thread:r.thread.map(t=>({id:t.id,direction:t.direction,at:t.created_at,notes:t.notes,review:t.metadata?.partnership_review}))})),inbound:inbound.length},null,2));
