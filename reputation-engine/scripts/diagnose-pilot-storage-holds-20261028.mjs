// Read-only: never reserves, retries, patches, or sends any email.
import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const worker=JSON.parse(fs.readFileSync(dir+'ready-backlog-worker.json'));
const ids=worker.held.filter(r=>r.reason==='Email storage unavailable (400)').map(r=>r.jobId);
const report={at:new Date().toISOString(),scope:'read_only_no_retries',jobs:[]};
report.domain=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca',select:'domain,status,daily_cap,minimum_interval_seconds,next_send_at,checked_at,health,pause_reason,updated_at'});
report.sender=await db('email_sender_accounts',{from_email:'eq.john@saturnstarmovers.ca',select:'id,from_email,status,daily_cap,region,pause_reason,last_error,last_health_checked_at'});
report.providerHealth=await db('crm_email_provider_health',{});
for(const id of ids){
 const [job]=await db('sequence_jobs',{id:'eq.'+id});
 const p=job.email_payload;
 const requests=await db('crm_email_requests',{request_key:'eq.prepared-email:'+p.actionKey});
 const attempts=requests.length?await db('crm_email_attempts',{request_id:'in.('+requests.map(r=>r.id).join(',')+')'}):[];
 const dispatch=await db('prepared_email_dispatches',{job_id:'eq.'+id});
 const [contact]=await db('market_contacts',{id:'eq.'+job.contact_id,select:'id,company,email,sequence_paused,sequence_paused_reason,email_status,do_not_contact,email_unsubscribed_at,last_inbound_at'});
 const receipts=await db('crm_email_receipts',{recipient:'eq.'+p.recipient,order:'occurred_at.desc',limit:'20'});
 const suppression=await db('crm_email_suppressions',{recipient:'eq.'+p.recipient});
 report.jobs.push({jobId:id,status:job.status,error:job.error,contact,dispatch,requests,attempts,receipts,suppression});
}
fs.writeFileSync(dir+'storage-hold-diagnostic.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
