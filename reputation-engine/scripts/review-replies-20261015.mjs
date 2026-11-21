import {fs,db,api} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/partnership-replies-20261015';fs.mkdirSync(dir,{recursive:true});
const inbound=await db('market_touches',{direction:'eq.inbound',created_at:'gte.2026-10-15T04:00:00Z',order:'created_at.asc',limit:'1000'});
if(inbound.length===1000)throw Error('Pagination required');
const ids=[...new Set(inbound.map(t=>t.contact_id))];
const rows=[];
for(const id of ids){const [cs,thread]=await Promise.all([db('market_contacts',{id:'eq.'+id}),db('market_touches',{contact_id:'eq.'+id,order:'created_at.asc,id.asc',limit:'1000'})]);if(thread.length===1000)throw Error('Thread pagination required');if(!thread.length&&!inbound.some(t=>t.contact_id===id))continue;rows.push({contact:cs[0],thread});}
fs.writeFileSync(dir+'/review.json',JSON.stringify({at:new Date().toISOString(),inboundCount:inbound.length,rows},null,2));
for(const r of rows)console.log(JSON.stringify({name:r.contact.name,id:r.contact.id,city:r.contact.city,suppressed:r.contact.do_not_contact||r.contact.cross_channel_suppressed_at,thread:r.thread.slice(-5).map(t=>({id:t.id,direction:t.direction,at:t.created_at,notes:t.notes,review:t.metadata?.partnership_review}))}));
