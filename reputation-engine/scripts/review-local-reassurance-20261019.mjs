import './realtor-runtime-20261019.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');
const dir='artifacts/local-reassurance-20261019';await fs.mkdir(dir,{recursive:true});
let inbound=[];for(let offset=0;;offset+=1000){const p=await db('market_touches',{direction:'eq.inbound',created_at:'gte.2026-10-19T18:15:00Z',order:'created_at.asc,id.asc',offset:String(offset),limit:'1000'});inbound.push(...p);if(p.length<1000)break;}
const ids=[...new Set(inbound.map(t=>t.contact_id).filter(Boolean))], rows=[];
for(const id of ids){const [c]=await db('market_contacts',{id:'eq.'+id});const thread=await db('market_touches',{contact_id:'eq.'+id,order:'created_at.asc,id.asc',limit:'1000'});if(thread.length===1000)throw Error('paginate');rows.push({contact:c,thread});}
await fs.writeFile(dir+'/review.json',JSON.stringify({at:new Date().toISOString(),rows},null,2));
console.log(JSON.stringify(rows.map(r=>({id:r.contact.id,name:r.contact.name,city:r.contact.city,suppressed:r.contact.do_not_contact||r.contact.cross_channel_suppressed_at,last:r.thread.slice(-4).map(t=>({id:t.id,at:t.created_at,dir:t.direction,text:t.notes,review:t.metadata?.partnership_review}))})),null,2));
