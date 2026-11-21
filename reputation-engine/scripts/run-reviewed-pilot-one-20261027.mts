import {api} from './gta-email-recovery-runtime.mjs';
import {db,base,headers} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
process.loadEnvFile('/Users/owoblo/Downloads/mission-control1/reputation-engine/.env.ses.local');
const root='/Users/owoblo/Downloads/mission-control1/reputation-engine/';
const dir=root+'artifacts/partnership-pilot-3000-20261027/';
const admission=JSON.parse(fs.readFileSync(dir+'first-reviewed-admission.json','utf8'));
const target=admission.records.find((r:any)=>r.organisation==='Fields Furniture & Fabrics'&&r.state==='queued');
if(!target)throw Error('Reviewed queued recipient missing');
const file=dir+'first-external-worker-result.json';
if(fs.existsSync(file))throw Error('Prior worker record exists. Reconcile instead of retrying.');
await api('/api/marketing/email-infrastructure',{action:'refresh'});
const [sender]=await db('email_sender_accounts',{provider:'eq.ses',from_email:'eq.john@saturnstarmovers.ca'});
if(sender?.from_name!=='John Owolabi'||sender.reply_to_email!=='business@starmovers.ca')throw Error('Sender identity changed');
await api('/api/marketing/email-infrastructure',{action:'update',id:sender.id,status:'warming',dailyCap:25});
const [job]=await db('sequence_jobs',{id:'eq.'+target.jobId});
const [contact]=await db('market_contacts',{id:'eq.'+target.contactId});
if(!job||job.status!=='pending'||job.email_payload?.contentHash!==target.payload.contentHash)throw Error('Queue entry changed');
const [claimed]=await db('sequence_jobs',{id:'eq.'+job.id,status:'eq.pending'},'PATCH',{status:'running',locked_at:new Date().toISOString(),attempts:Number(job.attempts||0)+1});
if(!claimed)throw Error('Queue entry claimed by another worker');
fs.writeFileSync(file,JSON.stringify({at:new Date().toISOString(),state:'started',jobId:job.id,organisation:target.organisation},null,2),{flag:'wx'});
try{
 const {executePreparedEmailJob}=await import('/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/lib/server/prepared-email-worker.ts');
 const receipt=await executePreparedEmailJob({job:claimed,contact,url:base,headers,enabled:true});
 const result={at:new Date().toISOString(),state:'provider_accepted',organisation:target.organisation,jobId:job.id,receipt};
 fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 const result={at:new Date().toISOString(),state:'held_or_uncertain',jobId:job.id,error:(error as Error).message};
 fs.writeFileSync(file,JSON.stringify(result,null,2));
 await db('sequence_jobs',{id:'eq.'+job.id},'PATCH',{status:'failed',locked_at:null,error:result.error});
 console.log(JSON.stringify(result));process.exitCode=1;
}
