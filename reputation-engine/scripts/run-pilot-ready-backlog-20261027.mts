import './gta-email-recovery-runtime.mjs';
import {installPilotStorageDiagnostics} from './pilot-storage-diagnostics-20261028.mjs';
installPilotStorageDiagnostics();
import {db,base,headers} from './reply-runtime-20261015.mjs';
import {runBoundedDispatch,serialGate} from '../lib/partnership-core/bounded-dispatch.mjs';
import {pilotDeliveryCapacity} from '../lib/partnership-core/pilot-delivery-capacity.mjs';
import fs from 'node:fs';
process.loadEnvFile('/Users/owoblo/Downloads/mission-control1/reputation-engine/.env.ses.local');
const dir='/Users/owoblo/Downloads/mission-control1/reputation-engine/artifacts/partnership-pilot-3000-20261027/';
const release='/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/';
const {executePreparedEmailJob}=await import(release+'lib/server/prepared-email-worker.ts');
const {reserveAction}=await import(release+'lib/partnership-core/reserve.mjs');
const {sendOutreachEmail}=await import(release+'lib/server/email-provider.ts');
const {refreshEmailInfrastructure}=await import(release+'lib/server/email-infrastructure.ts');
const lock=dir+'ready-backlog-worker.lock';
const fd=fs.openSync(lock,'wx');fs.writeSync(fd,String(process.pid));fs.closeSync(fd);
process.on('exit',()=>{try{fs.unlinkSync(lock)}catch{}});
const report:any={startedAt:new Date().toISOString(),pid:process.pid,concurrency:8,accepted:[],held:[],state:'starting',scope:'Only persisted reviewed pilot admissions; no new recipients invented'};
const save=()=>fs.writeFileSync(dir+'ready-backlog-worker.json',JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const gate=serialGate();
const policyGate=serialGate();
const reserve=(input:any)=>policyGate(()=>reserveAction(input));
let nextSendPermitAt=0;
async function health(){
 let [d]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
 if(!d?.health?.ready||Date.now()-Date.parse(d.checked_at)>300000){await refreshEmailInfrastructure();[d]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});}
 if(!d?.health?.ready||!['warming','active'].includes(d.status))throw Error('Domain readiness unavailable');
}
async function send(payload:any){
 await gate(async()=>{
 const [d]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
 const domainReadyAt=Date.parse(d.next_send_at||'')||0;
 const permitAt=Math.max(Date.now(),domainReadyAt,nextSendPermitAt);
 nextSendPermitAt=permitAt+1100;
 const remaining=permitAt-Date.now();if(remaining>0)await wait(remaining+30);
 });
 return sendOutreachEmail(payload);
}
const deadline=Date.now()+30*60*1000;
try{
 while(Date.now()<deadline){
  const names=['first-reviewed-admission.json',...fs.readdirSync(dir).filter(n=>/^additional-reviewed-.*\.json$/.test(n))];
  const map=new Map();
  for(const name of names)for(const r of JSON.parse(fs.readFileSync(dir+name,'utf8')).records||[])if(r.jobId&&r.payload)map.set(r.jobId,r);
  // The owner targets distinct deliveries, not 3,000 attempted queue rows.
  // Retain slots for uncertain/accepted outcomes; only known adverse receipts release them.
  if(map.size>10000)throw Error('Unexpected pilot inventory size; review campaign scope');
  const rows:any[]=[];
  const ids=[...map.keys()];
  for(let i=0;i<ids.length;i+=80){
   const jobs=await db('sequence_jobs',{id:'in.('+ids.slice(i,i+80).join(',')+')',status:'eq.pending'});
   for(const job of jobs)rows.push({...map.get(job.id),job});
  }
  const dispatches:any[]=[],events:any[]=[];
  for(let i=0;i<ids.length;i+=80)dispatches.push(...await db('prepared_email_dispatches',{job_id:'in.('+ids.slice(i,i+80).join(',')+')',limit:'1000'}));
  const messageIds=dispatches.map(d=>d.message_id).filter(Boolean);
  for(let i=0;i<messageIds.length;i+=60)events.push(...await db('email_provider_events',{provider_message_id:'in.('+messageIds.slice(i,i+60).join(',')+')',event_type:'in.(email_delivered,email_bounced,email_complained,email_rejected)',select:'provider_message_id,event_type',limit:'1000'}));
  const capacity=pilotDeliveryCapacity({dispatches:dispatches.map(d=>({...d,recipient:map.get(d.job_id)?.payload?.recipient})),events});
  report.capacity=capacity;
  if(capacity.distinctDelivered>=3000){report.state='delivery_target_reached';save();break;}
  rows.splice(capacity.availableInitialSlots);
  report.admitted=map.size;report.pending=rows.length;report.state=rows.length?'dispatching':'waiting_for_reviewed_backlog';save();
  if(!rows.length){await wait(10000);continue;}
  await health();
  const result=await runBoundedDispatch(rows,8,async(row:any)=>{
   const [job]=await db('sequence_jobs',{id:'eq.'+row.jobId});
   if(job?.status!=='pending')return {skipped:true};
   if(job.email_payload?.contentHash!==row.payload.contentHash)throw Error('Reviewed content changed');
   const [contact]=await db('market_contacts',{id:'eq.'+row.contactId});
   const [claimed]=await db('sequence_jobs',{id:'eq.'+job.id,status:'eq.pending'},'PATCH',{status:'running',locked_at:new Date().toISOString(),attempts:Number(job.attempts||0)+1});
   if(!claimed)return {skipped:true};
   try{
    const receipt=await executePreparedEmailJob({job:claimed,contact,url:base,headers,enabled:true},{send,reserve});
    const saved={organisation:row.organisation,jobId:job.id,...receipt,at:new Date().toISOString()};
    report.accepted.push(saved);save();console.log(JSON.stringify(saved));return saved;
   }catch(error){
    const reason=(error as Error).message;
    await db('sequence_jobs',{id:'eq.'+job.id},'PATCH',{status:'failed',locked_at:null,error:reason});
    report.held.push({jobId:job.id,reason});save();
    if(reason.startsWith('Partnership policy hold:'))return {held:true,reason};
    throw error;
   }
  });
  if(result.stopped)throw Error('Dispatch held; reconcile before continuing');
 }
 report.state='bounded_run_completed';save();
}catch(error){report.state='stopped_for_review';report.error=(error as Error).message;save();throw error;}
