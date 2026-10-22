// Append-only source events; projections never imply that latest arrival is truth.
const types=new Set(['interaction.sent','interaction.human_reply','contact.suppressed','promise.created','promise.fulfilled','referral.introduced','outcome.recorded']);
export function project(events){
 const seen=new Map(),accounts=new Map();
 for(const e of events){
  if(!e.id||!e.accountId||!types.has(e.type)||!Number.isFinite(Date.parse(e.occurredAt))||!Number.isFinite(Date.parse(e.recordedAt))||!e.evidenceRef)throw Error('Invalid event');
  if(seen.has(e.id)){if(JSON.stringify(seen.get(e.id))!==JSON.stringify(e))throw Error('Conflicting event ID');continue;}seen.set(e.id,e);
 }
 for(const e of [...seen.values()].sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.id.localeCompare(b.id))){
  const a=accounts.get(e.accountId)||{accountId:e.accountId,suppressed:false,humanReply:false,promises:{},introductions:[],outcomes:[],interactions:[]};
  if(e.type==='contact.suppressed')a.suppressed=true; // No implicit expiry or later-send override.
  if(e.type==='interaction.human_reply'){a.humanReply=true;a.interactions.push(e.id);}
  if(e.type==='interaction.sent')a.interactions.push(e.id);
  if(e.type.startsWith('promise.')){if(!e.payload?.promiseId)throw Error('Promise ID required');a.promises[e.payload.promiseId]={eventId:e.id,fulfilled:e.type==='promise.fulfilled'};}
  if(e.type==='referral.introduced')a.introductions.push({eventId:e.id,...e.payload});
  if(e.type==='outcome.recorded')a.outcomes.push({eventId:e.id,...e.payload});
  accounts.set(e.accountId,a);
 }
 return [...accounts.values()].map(a=>({...a,unresolvedPromise:Object.values(a.promises).some(p=>!p.fulfilled)}));
}
export function rankActions(actions,now=Date.now()){
 const priority={fulfil_promise:90,live_referral:85,reply:80,research:40,cold_introduction:20};
 return actions.filter(a=>a.status==='open').map(a=>({...a,priorityScore:(priority[a.kind]||0)+(Number.isFinite(Date.parse(a.dueAt))&&Date.parse(a.dueAt)<now?10:0)})).sort((a,b)=>b.priorityScore-a.priorityScore||String(a.id).localeCompare(String(b.id)));
}
