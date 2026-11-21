// Read-only audit. Output excludes credentials and message bodies. No sending endpoints.
import fs from 'node:fs';
import {db} from './gta-email-recovery-runtime.mjs';
const report={at:new Date().toISOString(),senders:await db('email_sender_accounts',{select:'id,from_email,provider,status,pause_reason'}),domains:await db('crm_email_domains',{select:'domain,status,pause_reason'}),dispatches:[]};
for(const d of await db('prepared_email_dispatches',{state:'in.(dispatching,ambiguous)',limit:'100'})){
 const [job]=await db('sequence_jobs',{id:'eq.'+d.job_id,select:'id,status,error,email_payload'});
 const touches=await db('market_touches',{'metadata->>sequence_job_id':'eq.'+d.job_id,select:'id,metadata,created_at'});
 const events=await db('email_provider_events',{recipient_email:'eq.'+job.email_payload.recipient,select:'id,provider,provider_message_id,event_type,occurred_at,payload',limit:'100'});
 report.dispatches.push({dispatch:d,job:{id:job?.id,status:job?.status,error:job?.error,recipient:job?.email_payload?.recipient},touches:touches.map(t=>({id:t.id,at:t.created_at,provider:t.metadata?.provider,messageId:t.metadata?.provider_message_id})),events:events.map(e=>{let p=e.payload;if(typeof p?.Message==='string'){try{p=JSON.parse(p.Message)}catch{}}return {id:e.id,provider:e.provider,messageId:e.provider_message_id,type:e.event_type,at:e.occurred_at,recipients:p?.mail?.destination,jobTags:p?.mail?.tags?.sequence_job_id}})});
}
fs.writeFileSync('artifacts/mail-platform-foundation-20261030/audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
