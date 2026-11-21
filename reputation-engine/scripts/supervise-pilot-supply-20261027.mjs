/** Persistent, restartable handoff for completed reviewed pilot batches. No discovery or guessed recipients. */
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {supplyStatus} from '../lib/partnership-core/review-supply.mjs';
import {admissionIdentities,checkedReviewRows,discoverFreshReviewBatches} from '../lib/partnership-core/fresh-review-discovery.mjs';
import {dailySupplyPlan} from '../lib/partnership-core/daily-supply-plan.mjs';
import {mailboxAdmissionQuality} from '../lib/partnership-core/mailbox-admission-quality.mjs';
const cwd='/Users/owoblo/Downloads/mission-control1/reputation-engine';
const dir=cwd+'/artifacts/partnership-pilot-3000-20261027/';
const execute=process.argv.includes('--execute'),watch=process.argv.includes('--watch');
const lock=dir+'supply-supervisor.lock';
if(fs.existsSync(lock)){
 const pid=Number(fs.readFileSync(lock,'utf8'));
 if(!Number.isInteger(pid)||pid<1)throw Error('Invalid supervisor lock requires review');
 try{process.kill(pid,0);throw Error('Supply supervisor already active');}
 catch(e){if(e.code!=='ESRCH')throw e;fs.unlinkSync(lock);}
}
fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
process.on('exit',()=>{try{fs.unlinkSync(lock)}catch{}});
const statePath=dir+'supply-supervisor.json';
const old=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):{};
const state={...old,pid:process.pid,startedAt:new Date().toISOString(),mode:execute?'execute':'audit',state:'starting',error:null};
const save=()=>{fs.writeFileSync(statePath+'.tmp',JSON.stringify({...state,updatedAt:new Date().toISOString()},null,2));fs.renameSync(statePath+'.tmp',statePath);};
let stop=false,sender=null,senderError=null,senderProcess=null;
process.on('SIGTERM',()=>{stop=true;senderProcess?.unref();});process.on('SIGINT',()=>{stop=true;senderProcess?.unref();});
function run(command,args,log){
 const fd=fs.openSync(dir+log,'a'),p=spawn(command,args,{cwd,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 if(log==='supply-sender.log'){senderProcess=p;p.on('exit',()=>{senderProcess=null;});}
 return new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('Child exited '+code+': '+log)));});
}
const read=name=>JSON.parse(fs.readFileSync(dir+name));
const validations=new Map(fs.readFileSync(dir+'ses-mailbox-validation.jsonl','utf8').trim().split('\n').map(JSON.parse).map(r=>[r.email.toLowerCase(),r.validation]));
function admissions(){
 const records=[];
 for(const name of ['first-reviewed-admission.json',...fs.readdirSync(dir).filter(n=>/^additional-reviewed-.*\.json$/.test(n))]){
  if(fs.existsSync(dir+name))records.push(...(read(name).records||[]));
 }
 for(const name of fs.readdirSync(dir).filter(n=>/^additional-reviewed-.*\.json\.journal\.jsonl$/.test(n))){
  const lines=fs.readFileSync(dir+name,'utf8').split('\n');for(const line of lines){if(!line.trim())continue;try{records.push(JSON.parse(line))}catch{throw Error('Malformed admission journal: '+name);}}
 }
 return admissionIdentities(records);
}
try{
 do{
  if(senderError)throw senderError;
  if(fs.existsSync(dir+'round3-supervisor.lock'))throw Error('Round3 supervisor still owns admission; no overlapping operators');
  const heartbeat=fs.existsSync(dir+'ready-backlog-worker.json')?read('ready-backlog-worker.json'):null;
  if(heartbeat?.state==='stopped_for_review')throw Error('Sender requires explicit outcome reconciliation before restart');
  await run(process.execPath,['scripts/pilot-delivery-status-20261027.mjs'],'supply-status.log');
  const status=read('live-pilot-status.json');
  if(status.providerDelivered>=3000){state.state='delivery_target_reached';save();break;}
  const known=admissions(),batches=[];state.originalDiscoveryHolds=[];
  for(const name of fs.readdirSync(dir).filter(n=>/^additional-reviewed-parallel-\d+-round\d+-source\.jsonl\.ready$/.test(n)).sort()){
   const source=name.slice(0,-6),text=fs.readFileSync(dir+source,'utf8');
   let batch;try{batch=checkedReviewRows(text,read(name),known)}catch(e){state.originalDiscoveryHolds.push({source,reason:e.message});continue;}
   if(batch.rows.length){
    if(batch.rows.some(r=>r.review_method!=='automated_evidence_rules_v1'||!mailboxAdmissionQuality(validations.get(r.email.toLowerCase())).automatic))throw Error('Completed source lacks mailbox quality: '+source);
    batches.push({...batch,source:dir+source});for(const r of batch.rows){known.ids.add(r.organisation_id);known.emails.add(r.email.toLowerCase());}
   }
  }
  const fresh=discoverFreshReviewBatches(cwd+'/artifacts/partnership-next-day-research-20261028',known);
  batches.push(...fresh.batches);state.freshCohortDiscovery={reviewBatches:fresh.batches.length,reviewedCandidates:fresh.batches.reduce((n,b)=>n+b.rows.length,0),holds:fresh.holds};
  state.supply=supplyStatus({pending:status.pending,running:status.running,ready:batches.reduce((n,b)=>n+b.rows.length,0)});
  // Plan ahead without representing unreviewed research as admitted recipients.
  // Follow-up allocation stays unknown until the dated step-two planner supplies it.
  state.nextDayPreparation={...dailySupplyPlan({readyInitials:state.supply.queued+state.supply.ready}),followupAllocationStatus:'pending_day3_planner',initialSlotsAreUpperBound:true};
  state.lastDeliveryCheck=status.at;state.confirmedDelivered=status.providerDelivered;state.state=state.supply.state;save();
  if(execute&&state.supply.reviewNeeded>0){
   await import('./gta-email-recovery-runtime.mjs');
   const {db}=await import('./reply-runtime-20261015.mjs');
   const id='pilot-3000-reviewed-supply-20261027';
   const [task]=await db('crm_tasks',{id:'eq.'+id,limit:'1'});
   const description=JSON.stringify({checkedAt:new Date().toISOString(),...state.supply,confirmedDelivered:status.providerDelivered,nextAction:'Prepare additional evidence-supported pilot recipients. This alert does not authorize bypassing review or retrying held recipients.'});
   if(!task)await db('crm_tasks',{},'POST',{id,title:'Pilot recipient review buffer needs replenishment',description,status:'open',priority:'high',category:'partnerships',owner_name:'John',source:'condition',source_key:id,created_by_name:'Pilot supply monitor'});
   else await db('crm_tasks',{id:'eq.'+id},'PATCH',{description,status:'open'});
  }
  if(execute&&(status.pending>0||batches.length)&&!sender&&!fs.existsSync(dir+'ready-backlog-worker.lock')){
   sender=run(cwd+'/node_modules/.bin/tsx',['scripts/run-pilot-ready-backlog-20261027.mts'],'supply-sender.log').catch(e=>{senderError=e;}).finally(()=>{sender=null;});
  }
  for(const batch of execute?batches:[]){
   state.state='admitting';state.currentSource=batch.source;save();
   const index=read('mailbox-address-index.json');
   if(Date.now()-Date.parse(index.startedAt)>8*60*1000)await run(process.execPath,['scripts/build-pilot-mailbox-index-20261027.mjs'],'supply-index.log');
   const key=batch.key||batch.sha256.slice(0,20),snapshot='supply-frozen-'+key+'.jsonl',text=batch.rows.map(JSON.stringify).join('\n')+'\n';
   // On restart, reuse the original immutable input so the admission journal can recover prior queued rows.
   if(!fs.existsSync(dir+snapshot))fs.writeFileSync(dir+snapshot,text,{flag:'wx'});
   const allowedRows=new Set(fs.readFileSync(batch.source,'utf8').split('\n').filter(Boolean).map(line=>JSON.stringify(JSON.parse(line))));
   const frozenRows=fs.readFileSync(dir+snapshot,'utf8').split('\n').filter(Boolean).map(line=>JSON.stringify(JSON.parse(line)));
   if(!frozenRows.length||frozenRows.some(row=>!allowedRows.has(row)))throw Error('Frozen supply snapshot differs from reviewed source');
   await run(process.execPath,['scripts/admit-reviewed-pilot-batch-20261027.mjs','--reviews',dir+snapshot,'--output','additional-reviewed-supply-'+key+'.json',...(batch.candidateRoot?['--candidate-root',batch.candidateRoot]:[]),'--admit'],'supply-admission.log');
  }
  if(watch&&!stop)await new Promise(r=>setTimeout(r,60000));
 }while(watch&&!stop);
}catch(e){state.state='stopped_for_review';state.error=e.message;save();process.exitCode=1;}
