import './gta-email-recovery-runtime.mjs';import {db} from './reply-runtime-20261015.mjs';import fs from 'node:fs/promises';
const dir='artifacts/toronto-subcontractors-20261017';const {selected}=JSON.parse(await fs.readFile(dir+'/count.json'));
const phones=selected.map(c=>c.phone).filter(Boolean);const rows=[];
for(let offset=0;;offset+=1000){const page=await db('sms_messages',{or:'('+['from_number','to_number'].map(k=>k+'.in.('+phones.join(',')+')').join(',')+')',order:'created_at.asc,id.asc',limit:1000,offset});rows.push(...page);if(page.length<1000)break;}
await fs.writeFile(dir+'/sms-threads.json',JSON.stringify(rows,null,2));
for(const c of selected){const ts=rows.filter(r=>r.from_number===c.phone||r.to_number===c.phone);if(ts.some(r=>r.direction==='inbound'))console.log(JSON.stringify({name:c.company_name,phone:c.phone,status:c.status,notes:c.notes,availability:c.availability_notes,thread:ts.map(r=>({at:r.created_at,direction:r.direction,body:r.body}))}));}
