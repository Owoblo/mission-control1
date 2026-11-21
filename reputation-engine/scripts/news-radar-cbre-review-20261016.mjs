import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs/promises';
const contacts=await db('market_contacts',{company:'ilike.*CBRE*',limit:1000});
const rows=[];
for(const c of contacts){const touches=await db('market_touches',{contact_id:'eq.'+c.id,limit:1000});const tasks=await db('crm_tasks',{related_id:'eq.'+c.id,status:'in.(open,in_progress)'});rows.push({contact:c,touches,tasks});}
await fs.writeFile('artifacts/news-radar-deep-20261016/cbre-full-account-review.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(r=>({id:r.contact.id,name:r.contact.name,city:r.contact.city,companyId:r.contact.partner_company_id,suppressed:!!(r.contact.do_not_contact||r.contact.email_unsubscribed_at||r.contact.cross_channel_suppressed_at),touches:r.touches.length,inbound:r.touches.filter(t=>t.direction==='inbound').map(t=>t.notes),tasks:r.tasks.map(t=>({title:t.title,description:t.description}))})),null,2));
