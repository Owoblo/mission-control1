import fs from 'node:fs/promises';
import {db} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/realtor-batch-20261019';let leads=[];
for(let offset=0;;offset+=1000){const rows=await db('crm_leads',{select:'id,data,deleted',order:'id.asc',offset:String(offset),limit:'1000'});leads.push(...rows);if(rows.length<1000)break;}
const norm=p=>String(p||'').replace(/\D/g,'').slice(-10);
const phones=new Set(leads.map(r=>norm(r.data?.phone)).filter(Boolean));const emails=new Set(leads.map(r=>String(r.data?.email||'').trim().toLowerCase()).filter(Boolean));
const eligible=JSON.parse(await fs.readFile(dir+'/eligible.json','utf8'));
const holds=eligible.filter(c=>phones.has(norm(c.phone))||(c.email&&emails.has(c.email.trim().toLowerCase())));
await fs.writeFile(dir+'/sales-overlap-holds.json',JSON.stringify(holds,null,2));
console.log(JSON.stringify({sales_records:leads.length,overlaps:holds.length,names:holds.map(c=>c.name)}));
