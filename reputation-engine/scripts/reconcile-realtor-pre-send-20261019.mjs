import fs from 'node:fs/promises';
import {db} from './reply-runtime-20261015.mjs';
const rows=await db('sequence_jobs',{'sms_payload->>campaign_key':'eq.gta-20261019-intro-v1',status:'eq.failed',provider_sid:'is.null',select:'id,contact_id,status,provider_sid,last_error,attempts'});
const findings=[];
for(const j of rows){if(!['Error: Policy reservation unavailable (500)','Policy reservation unavailable (500)'].includes(j.last_error))continue;const [reservations,touches]=await Promise.all([db('partnership_action_reservations',{contact_id:'eq.'+j.contact_id}),db('market_touches',{contact_id:'eq.'+j.contact_id})]);findings.push({job:j,reservations,touches});}
await fs.writeFile('artifacts/realtor-batch-20261019/pre-send-hold-review.json',JSON.stringify(findings,null,2));
console.log(JSON.stringify(findings.map(r=>({job:r.job,reservations:r.reservations.length,touches:r.touches.length}))));
if(process.argv.includes('--apply'))for(const r of findings){
 if(r.reservations.length||r.touches.length){console.log('Preserved ambiguous hold',r.job.id);continue;}
 // executePreparedSmsJob awaits reserveAction before making any provider request.
 const changed=await db('sequence_jobs',{id:'eq.'+r.job.id,status:'eq.failed',provider_sid:'is.null',last_error:'eq.'+r.job.last_error},'PATCH',Number(r.job.attempts||0)>=3?{status:'failed',locked_at:null,error:'Confirmed unsent after repeated pre-provider reservation failures',last_error:'confirmed_unsent_pre_provider_20261019'}:{status:'pending',locked_at:null,error:null,last_error:null});
 if(changed.length!==1)throw Error('Job changed during reconciliation');
 await fs.appendFile('artifacts/realtor-batch-20261019/pre-send-reconciled.jsonl',JSON.stringify({at:new Date().toISOString(),job_id:r.job.id,reason:'Reservation RPC failed before provider call; zero reservations and touches; requeued existing job without creating new recipient or bypassing policy.'})+'\n');console.log('Requeued proven pre-provider failure',r.job.id);
}
