import './gta-email-recovery-runtime.mjs';import {db} from './reply-runtime-20261015.mjs';import fs from 'node:fs/promises';import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,headers={Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')};
const out={};for(const id of ['CAac59b7023b0b08e97fcfa24b853aaca6','CAa1c1250eeed447537fa4bd1cbccc7e65','CA71884df6ea6f9b46cbfbe0fee04dfcec']){
 out[id]={};for(const [key,url] of Object.entries({children:`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?ParentCallSid=${id}`,events:`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${id}/Events.json`})) {const r=await fetch(url,{headers});out[id][key]=await r.json();}
}
out.leads=await db('crm_leads',{'data->>phone':'ilike.*6166601*'});
out.contacts=await db('market_contacts',{phone:'ilike.*6601*'});
out.interactions=await db('crm_interactions',{'event->>occurredAt':'gte.2026-10-17T18:00:00Z',limit:100});
const box=await openZohoMailbox('saturn');out.alertEmails=await box.request('/accounts/'+box.accountId+'/messages/search?'+new URLSearchParams({searchKey:'subject:partner',start:'1',limit:'100'}));
await fs.writeFile('artifacts/call-investigation-20261017/details.json',JSON.stringify(out,null,2));
console.log('Saved call investigation details');
