/** Local receipt snapshot for the five withdrawn automated review batches.
 * Read-only: never changes queue state or retries sends.
 */
import fs from 'node:fs';
import path from 'node:path';
const pilot='artifacts/partnership-pilot-3000-20261027';
const status=JSON.parse(fs.readFileSync(path.join(pilot,'live-pilot-status.json')));
const jobs=new Map(status.jobs.map(x=>[x.id,x]));
const dispatches=new Map(status.dispatches.map(x=>[x.job_id,x]));
const events=new Map();for(const e of status.events){const a=events.get(e.provider_message_id)||[];a.push(e.event_type);events.set(e.provider_message_id,a)}
const roots=new Set(['verification-sixth100','verification-batch-020','verification-batch-021','verification-batch-022','verification-batch-023']);
const rows=[];
for(const name of fs.readdirSync(pilot).filter(x=>/^additional-reviewed-supply-.*\.json$/.test(x))){
 const report=JSON.parse(fs.readFileSync(path.join(pilot,name)));
 const batch=path.basename(report.candidateRoot||'');if(!roots.has(batch))continue;
 for(const r of report.records||[]){if(!r.jobId)continue;
  const job=jobs.get(r.jobId),dispatch=dispatches.get(r.jobId);
  rows.push({batch,admissionFile:name,organisation:r.organisation,recipient:r.email,jobId:r.jobId,jobStatus:job?.status||'not_in_last_snapshot',jobError:job?.error||null,dispatchState:dispatch?.state||null,providerMessageId:dispatch?.message_id||null,providerEvents:dispatch?.message_id?events.get(dispatch.message_id)||[]:[],reviewState:r.state,copyDefect:'conditional paragraph begins with undefined and review sector is an array'});
 }
}
const out={at:new Date().toISOString(),sourceStatusAt:status.at,scope:'read_only_local_snapshot_no_retry',affected:rows.length,byJobStatus:Object.fromEntries([...new Set(rows.map(r=>r.jobStatus))].map(k=>[k,rows.filter(r=>r.jobStatus===k).length])),rows};
fs.writeFileSync(path.join(pilot,'fresh-copy-bug-reconciliation.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({at:out.at,sourceStatusAt:out.sourceStatusAt,affected:out.affected,byJobStatus:out.byJobStatus,accepted:rows.filter(r=>r.providerMessageId).length,delivered:rows.filter(r=>r.providerEvents.includes('email_delivered')).length}));
