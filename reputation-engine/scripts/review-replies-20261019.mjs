import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/reply-review-20261019-weekend';await fs.mkdir(dir,{recursive:true});
async function all(table,q){const rows=[];for(let offset=0;;offset+=1000){const p=await db(table,{...q,limit:'1000',offset:String(offset)});rows.push(...p);if(p.length<1000)return rows;}}
const inbound=await all('market_touches',{direction:'eq.inbound',created_at:'gte.2026-10-16T04:00:00Z',order:'created_at.asc,id.asc'});
const ids=[...new Set(inbound.map(t=>t.contact_id))];
const rows=[];
for(const id of ids){const [contacts,thread,tasks]=await Promise.all([db('market_contacts',{id:'eq.'+id}),all('market_touches',{contact_id:'eq.'+id,order:'created_at.asc,id.asc'}),db('crm_tasks',{related_id:'eq.'+id,status:'in.(open,in_progress)'})]);rows.push({contact:contacts[0],thread,tasks});}
await fs.writeFile(dir+'/review.json',JSON.stringify({at:new Date().toISOString(),inboundCount:inbound.length,rows},null,2));
console.log(JSON.stringify({inbound:inbound.length,threads:rows.length}));
