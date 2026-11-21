import './gta-email-recovery-runtime.mjs';import {db} from './reply-runtime-20261015.mjs';import fs from 'node:fs/promises';
let rows=[];for(let offset=0;;offset+=1000){const p=await db('crm_leads',{'data->>createdAt':'gte.2026-10-05',order:'id.asc',limit:1000,offset});rows.push(...p);if(p.length<1000)break;}
await fs.mkdir('artifacts/gta-leads-week-20261005',{recursive:true});await fs.writeFile('artifacts/gta-leads-week-20261005/data.json',JSON.stringify(rows));
console.log('Saved live leads');
