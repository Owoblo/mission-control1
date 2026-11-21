import './gta-email-recovery-runtime.mjs';
import {db} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
const ids=['e5c20276-2691-4f8f-988c-6459465df382','6137c2ed-2b1e-4fdc-9107-d3cdf7a5e761','3ce7f8be-10eb-4af9-896d-e1a0e50df563','0bda0235-cc93-4811-a4fb-ff0a3bdac758','9c1a4e5b-ae12-4721-b8df-65dc20747689'];
const audit=[];const path='artifacts/partnership-pilot-3000-20261027/preflight-hold-reconciliation.json';
for(const id of ids){
 const [j]=await db('sequence_jobs',{id:'eq.'+id});
 if(j.status!=='failed')continue;
 const [d]=await db('prepared_email_dispatches',{job_id:'eq.'+id});
 const requests=await db('crm_email_requests',{request_key:'eq.prepared-email:'+j.email_payload.actionKey});
 if(d?.state!=='held'||d.message_id||requests.length)throw Error('Cannot prove pre-provider failure: '+id);
 const evidence={at:new Date().toISOString(),jobId:id,previousError:j.error,dispatch:d,providerRequests:requests,reason:'Confirmed failure before provider reservation; preserve reviewed payload and retry through all original checks'};
 audit.push(evidence);fs.writeFileSync(path,JSON.stringify(audit,null,2));
 await db('prepared_email_dispatches',{job_id:'eq.'+id,state:'eq.held',message_id:'is.null'},'DELETE');
 await db('sequence_jobs',{id:'eq.'+id,status:'eq.failed'},'PATCH',{status:'pending',locked_at:null,error:null});
}
console.log(JSON.stringify({reconciled:audit.length}));
