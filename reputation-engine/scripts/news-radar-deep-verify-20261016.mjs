import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs/promises';
const dir='artifacts/news-radar-deep-20261016',rows=[];
for(const file of await fs.readdir(dir+'/receipts')){
 const receipt=JSON.parse(await fs.readFile(dir+'/receipts/'+file));
 const touches=await db('market_touches',{contact_id:'eq.'+receipt.contactId,order:'created_at.asc',limit:1000});
 const matching=touches.filter(t=>t.metadata?.provider_message_id===receipt.messageId);
 const outbound=matching.filter(t=>t.direction==='outbound');
 const [contact]=await db('market_contacts',{id:'eq.'+receipt.contactId});
 rows.push({name:receipt.plan.name,company:receipt.plan.company,email:receipt.plan.email,provider:receipt.provider,receipt:receipt.messageId,state:receipt.state,crmOutboundCount:outbound.length,sequencePaused:contact.sequence_paused,events:matching.map(t=>({id:t.id,direction:t.direction,notes:t.direction==='outbound'?undefined:t.notes,metadata:t.metadata})),delivery:matching.some(t=>/email_delivered/.test(t.notes))?'delivered':matching.some(t=>/email_bounced|email_complained/.test(t.notes))?'failure':'not_confirmed'});
}
await fs.writeFile(dir+'/verification.json',JSON.stringify({at:new Date().toISOString(),rows},null,2));
console.log(JSON.stringify(rows.map(({events,...r})=>r),null,2));
if(rows.some(r=>r.crmOutboundCount!==1||!r.sequencePaused))process.exitCode=1;
