import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const report=JSON.parse(fs.readFileSync(dir+'ready-backlog-worker.json'));
const reconciled=JSON.parse(fs.readFileSync(dir+'round4-preflight-reconciliation.json'));
const audit=[];
for(const row of report.held){
 const [job]=await db('sequence_jobs',{id:'eq.'+row.jobId});
 if(reconciled.some(r=>r.jobId===row.jobId)){
  if(job.status!=='pending')throw Error('Reconciled status changed');
 }else{
  if(row.reason!=='Partnership policy hold: market_not_active, service_not_confirmed'||job.status!=='failed'||job.error!==row.reason)throw Error('Unreviewed hold remains');
  const [dispatch]=await db('prepared_email_dispatches',{job_id:'eq.'+row.jobId});
  if(dispatch?.state!=='held'||dispatch.message_id||dispatch.provider)throw Error('Policy hold outcome ambiguous');
 }
 audit.push({jobId:job.id,status:job.status,reason:job.error});
}
fs.writeFileSync(dir+'fresh-worker-stop-reconciliation.json',JSON.stringify({at:new Date().toISOString(),original:report,decisions:audit,scope:'Three proven presend retries; unsupported market jobs remain failed'},null,2));
fs.writeFileSync(dir+'ready-backlog-worker.json',JSON.stringify({...report,state:'preflight_holds_reconciled',error:null,reconciledAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({reconciled:3,retainedPolicyHolds:audit.filter(r=>r.status==='failed').length}));
