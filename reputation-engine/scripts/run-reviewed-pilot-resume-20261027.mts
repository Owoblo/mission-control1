import './gta-email-recovery-runtime.mjs';
import {db,base,headers} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
process.loadEnvFile('/Users/owoblo/Downloads/mission-control1/reputation-engine/.env.ses.local');
const dir='/Users/owoblo/Downloads/mission-control1/reputation-engine/artifacts/partnership-pilot-3000-20261027/';
const rows=JSON.parse(fs.readFileSync(dir+'first-reviewed-admission.json','utf8')).records.filter((r:any)=>r.state==='queued');
const {executePreparedEmailJob}=await import('/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/lib/server/prepared-email-worker.ts');
const {refreshEmailInfrastructure}=await import('/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/lib/server/email-infrastructure.ts');
const report:any={startedAt:new Date().toISOString(),pid:process.pid,scope:'Only the individually reviewed first admission batch',selected:rows.length,accepted:[],held:[],state:'running'};
const save=()=>fs.writeFileSync(dir+'reviewed-queue-worker-resume.json',JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
save();
for(const row of rows){
 const [initial]=await db('sequence_jobs',{id:'eq.'+row.jobId});
 if(initial?.status==='sent')continue;
 if(initial?.status!=='pending'){report.held.push({jobId:row.jobId,reason:'Job is not pending; no retry'});continue;}
 // Wait for a real mailbox readiness recovery; never turn a failed check into approval.
 for(let check=0;;check++){
  const [health]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
  if(health?.health?.ready && Date.now()-Date.parse(health.checked_at)<300000)break;
  if(check>=6)throw Error('Mailbox readiness still unavailable; bounded recovery stopped');
  report.state='waiting_for_mailbox_recovery';report.recoveryCheck=check;save();
  await new Promise(resolve=>setTimeout(resolve,60000));
  await refreshEmailInfrastructure();
 }
 while(true){
  const [domain]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
  const [sender]=await db('email_sender_accounts',{provider:'eq.ses',from_email:'eq.john@saturnstarmovers.ca'});
  if(!['warming','active'].includes(domain?.status)||!['warming','active'].includes(sender?.status))throw Error('Sender paused; stop worker');
  const wait=Date.parse(domain.next_send_at||'')-Date.now();
  if(!Number.isFinite(wait)||wait<=0)break;
  report.state='waiting_for_domain_interval';report.nextAttemptAt=domain.next_send_at;save();
  await new Promise(resolve=>setTimeout(resolve,Math.min(wait+1000,30000)));
 }
 const [job]=await db('sequence_jobs',{id:'eq.'+row.jobId});
 if(job?.status!=='pending')continue;
 if(job.email_payload?.contentHash!==row.payload.contentHash)throw Error('Reviewed queue content changed');
 const [contact]=await db('market_contacts',{id:'eq.'+row.contactId});
 const [claimed]=await db('sequence_jobs',{id:'eq.'+job.id,status:'eq.pending'},'PATCH',{status:'running',locked_at:new Date().toISOString(),attempts:Number(job.attempts||0)+1});
 if(!claimed)continue;
 report.state='dispatching';report.currentJobId=job.id;save();
 try{
  const receipt=await executePreparedEmailJob({job:claimed,contact,url:base,headers,enabled:true});
  report.accepted.push({organisation:row.organisation,jobId:job.id,...receipt,at:new Date().toISOString()});
  console.log(JSON.stringify(report.accepted.at(-1)));save();
 }catch(error){
  const reason=(error as Error).message;
  await db('sequence_jobs',{id:'eq.'+job.id},'PATCH',{status:'failed',locked_at:null,error:reason});
  report.held.push({jobId:job.id,reason});report.state='stopped_for_review';save();console.log(JSON.stringify({held:reason,jobId:job.id}));process.exit(1);
 }
}
report.state='completed';save();console.log(JSON.stringify({state:report.state,acceptedThisRun:report.accepted.length,held:report.held.length}));
