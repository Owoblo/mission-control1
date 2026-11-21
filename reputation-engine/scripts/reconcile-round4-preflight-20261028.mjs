import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const diagnostic=JSON.parse(fs.readFileSync(dir+'storage-hold-diagnostic.json'));
const [domain]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
if(!domain?.health?.ready||Date.now()-Date.parse(domain.checked_at)>300000)throw Error('Fresh healthy sender required');
const audit=[];
for(const row of diagnostic.jobs){
 const id=row.jobId;
 const [job]=await db('sequence_jobs',{id:'eq.'+id});
 if(job?.status!=='failed'||!['Email storage unavailable (400)','Partnership policy hold: existing_reservation_inspect_before_retry'].includes(job.error))throw Error('Failure changed: '+id);
 const [dispatch]=await db('prepared_email_dispatches',{job_id:'eq.'+id});
 const requests=await db('crm_email_requests',{request_key:'eq.prepared-email:'+job.email_payload.actionKey});
 if(dispatch?.state!=='held'||dispatch.message_id||dispatch.provider||requests.length)throw Error('Not proven pre-provider: '+id);
 const touches=await db('market_touches',{contact_id:'eq.'+job.contact_id,channel:'eq.email',direction:'eq.outbound',limit:'1'});
 const events=await db('email_provider_events',{recipient_email:'ilike.'+job.email_payload.recipient,limit:'1'});
 if(touches.length||events.length)throw Error('Send evidence requires review: '+id);
 audit.push({at:new Date().toISOString(),jobId:id,dispatch,requests,reason:'Explicit reconciliation of confirmed pre-provider hold after successful sender health refresh; preserve exact payload'});
 fs.writeFileSync(dir+'round4-preflight-reconciliation.json',JSON.stringify(audit,null,2));
 const eventKey='round4-preflight-reconciled:'+job.email_payload.actionKey;
 if(!(await db('partnership_policy_events',{event_key:'eq.'+eventKey})).length)await db('partnership_policy_events',{},'POST',{event_key:eventKey,account_id:job.email_payload.accountId,action_key:job.email_payload.actionKey,event_type:'action.reconciled_no_provider_record',evidence:{owner_authorized_retry:true,contact_id:job.contact_id,provider_send_attempted:false,reason:'Audited transport preflight failure; no requests, attempts, receipts or outbound touches'}});
 await db('partnership_action_reservations',{action_key:'eq.'+job.email_payload.actionKey,contact_id:'eq.'+job.contact_id,channel:'eq.email'},'DELETE');
 await db('prepared_email_dispatches',{job_id:'eq.'+id,state:'eq.held',message_id:'is.null'},'DELETE');
 await db('sequence_jobs',{id:'eq.'+id,status:'eq.failed'},'PATCH',{status:'pending',locked_at:null,error:null});
}
// Only clear the local stopped marker when every recorded failure belongs to this audited incident.
const worker=JSON.parse(fs.readFileSync(dir+'ready-backlog-worker.json'));
if(worker.state==='stopped_for_review'&&worker.held.every(r=>audit.some(a=>a.jobId===r.jobId))){
 fs.writeFileSync(dir+'ready-backlog-worker-round4-before-reconciliation.json',JSON.stringify(worker,null,2));
 fs.writeFileSync(dir+'ready-backlog-worker.json',JSON.stringify({...worker,state:'preflight_holds_reconciled',error:null,reconciledAt:new Date().toISOString()},null,2));
}
console.log(JSON.stringify({reconciled:audit.length,sendsByThisScript:0}));
