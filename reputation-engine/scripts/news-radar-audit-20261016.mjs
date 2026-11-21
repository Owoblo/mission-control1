import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {SESv2Client,GetAccountCommand} from '@aws-sdk/client-sesv2';
import fs from 'node:fs/promises';
const dir='artifacts/news-radar-outreach-20261016';
const patterns=['pharmaline','prescott','gohba','hammond','windsorpubliclibrary','lstar','ckha','costco','viprail','alpenglow','unique tool','paskal','omega tool','dainty','limitless','trident','summerheaven','upper credit','arq wellness','wellington','brantlibrary','schulich','och.ca','arriv.ca','chatham-kent.ca','ledc.com','capitalward'];
const all=[];for(let offset=0;;offset+=1000){const rows=await db('market_contacts',{select:'*',order:'id.asc',limit:'1000',offset:String(offset)});all.push(...rows);if(rows.length<1000)break;}
await fs.writeFile(dir+'/crm-contacts-snapshot.json',JSON.stringify({at:new Date().toISOString(),rows:all}));
const hits=all.filter(c=>patterns.some(p=>[c.company,c.email,c.name,c.website].join(' ').toLowerCase().includes(p)));
await fs.writeFile(dir+'/matched-contacts.json',JSON.stringify(hits,null,2));
console.log(JSON.stringify({all:all.length,matches:hits.map(c=>({id:c.id,name:c.name,email:c.email,company:c.company,city:c.city,dnc:c.do_not_contact,status:c.email_status,last:c.last_touch_at}))}));
for(const market of ['saturn','ottawa']){try{const mb=await openZohoMailbox(market);console.log(JSON.stringify({mailbox:market,readable:true}));}catch(e){console.log(JSON.stringify({mailbox:market,error:e.message}));}}
const r=await new SESv2Client({region:process.env.AWS_REGION||'us-east-2'}).send(new GetAccountCommand({}));await fs.writeFile(dir+'/ses-health.json',JSON.stringify(r,null,2));console.log(JSON.stringify({ses:{production:r.ProductionAccessEnabled,sending:r.SendingEnabled,enforcement:r.EnforcementStatus}}));
