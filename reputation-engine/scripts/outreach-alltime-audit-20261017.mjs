import './gta-email-recovery-runtime.mjs';import {db} from './reply-runtime-20261015.mjs';import fs from 'node:fs/promises';
async function all(table,query){const rows=[];for(let offset=0;;offset+=1000){const page=await db(table,{...query,order:'id.asc',limit:1000,offset});rows.push(...page);if(page.length<1000)break;}return rows;}
const touches=await all('market_touches',{direction:'eq.outbound',select:'id,contact_id,channel,created_at,notes,metadata'});
const contacts=await all('market_contacts',{select:'id,phone,email,city'});
const contractors=await all('subcontractors',{select:'id,company_name,phone,notes'});
const smses=await all('sms_messages',{direction:'eq.outbound',select:'id,from_number,to_number,body,twilio_sid,created_at,lead_id'});
const dir='artifacts/outreach-alltime-20261017';await fs.mkdir(dir,{recursive:true});await fs.writeFile(dir+'/data.json',JSON.stringify({at:new Date().toISOString(),touches,contacts,contractors,smses}));
console.log(JSON.stringify({touches:touches.length,contacts:contacts.length,contractors:contractors.length,smses:smses.length,channels:touches.reduce((a,t)=>(a[t.channel]=(a[t.channel]||0)+1,a),{})}));
