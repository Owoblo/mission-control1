import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mailboxAdmissionQuality} from '../lib/partnership-core/mailbox-admission-quality.mjs';
const cwd='/Users/owoblo/Downloads/mission-control1/reputation-engine';
const dir=cwd+'/artifacts/partnership-pilot-3000-20261027/';
const lock=dir+'round3-supervisor.lock';
fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
process.on('exit',()=>{try{fs.unlinkSync(lock)}catch{}});
const report={startedAt:new Date().toISOString(),pid:process.pid,state:'starting',completed:[],error:null};
const save=()=>fs.writeFileSync(dir+'round3-supervisor.json',JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function child(command,args,log){
 const fd=fs.openSync(dir+log,'a');const p=spawn(command,args,{cwd,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 return new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(command+' exited '+code+'; inspect '+log)));});
}
const validations=new Map(fs.readFileSync(dir+'ses-mailbox-validation.jsonl','utf8').trim().split('\n').map(JSON.parse).map(r=>[r.email.toLowerCase(),r.validation]));
let sender=null,senderError=null;
function startSender(){
 if(sender||fs.existsSync(dir+'ready-backlog-worker.lock'))return;
 sender=child(cwd+'/node_modules/.bin/tsx',['scripts/run-pilot-ready-backlog-20261027.mts'],'round3-sender.log').catch(e=>{senderError=e;}).finally(()=>{sender=null;});
}
try{
 const deadline=Date.now()+60*60*1000;
 while(Date.now()<deadline){
  if(senderError)throw senderError;
  startSender();
  for(const i of [1,2,3]){
   if(report.completed.includes(i))continue;
   const name=`additional-reviewed-parallel-${i}-round3-source.jsonl`;
   if(!fs.existsSync(dir+name+'.ready'))continue;
   const marker=JSON.parse(fs.readFileSync(dir+name+'.ready'));
   if(marker.complete!==true)continue;
   const text=fs.readFileSync(dir+name,'utf8');
   const rows=text.trim()?text.trim().split('\n').map(JSON.parse):[];
   if(rows.length!==marker.count||new Set(rows.map(r=>r.organisation_id)).size!==rows.length)throw Error('Invalid completed batch '+i);
   if(rows.some(r=>r.review_method!=='automated_evidence_rules_v1'||!mailboxAdmissionQuality(validations.get(r.email.toLowerCase())).automatic))throw Error('Mailbox quality/review method failed '+i);
   if(rows.length){
    report.state='admitting_shard_'+i;save();
    const index=JSON.parse(fs.readFileSync(dir+'mailbox-address-index.json'));
    if(Date.now()-Date.parse(index.startedAt)>8*60*1000)await child(process.execPath,['scripts/build-pilot-mailbox-index-20261027.mjs'],'round3-index.log');
    const hash=createHash('sha256').update(text).digest('hex');
    const snapshot=`additional-reviewed-round3-frozen-${i}.jsonl`;
    if(fs.existsSync(dir+snapshot)&&fs.readFileSync(dir+snapshot,'utf8')!==text)throw Error('Frozen source changed');
    fs.writeFileSync(dir+snapshot,text);
    await child(process.execPath,['scripts/admit-reviewed-pilot-batch-20261027.mjs','--reviews',dir+snapshot,'--output',`additional-reviewed-round3-shard-${i}-batch.json`,'--admit'],`round3-admission-${i}.log`);
    if(createHash('sha256').update(fs.readFileSync(dir+name)).digest('hex')!==hash)throw Error('Source changed during admission');
   }
   report.completed.push(i);save();
  }
  report.state=report.completed.length===3?'monitoring_admitted_batches':'waiting_for_completed_reviews';save();
  const heartbeat=fs.existsSync(dir+'ready-backlog-worker.json')?JSON.parse(fs.readFileSync(dir+'ready-backlog-worker.json')):null;
  if(heartbeat?.state==='stopped_for_review'&&Date.parse(heartbeat.startedAt)>=Date.parse(report.startedAt))throw Error('Sender stopped; reconcile ambiguous outcome before restart');
  if(report.completed.length===3&&heartbeat?.state==='waiting_for_reviewed_backlog'&&Date.parse(heartbeat.updatedAt)>Date.parse(report.startedAt)){
   report.state='all_round3_batches_processed';save();break;
  }
  await wait(5000);
 }
 if(report.state!=='all_round3_batches_processed'){report.state='bounded_supervision_completed';save();}
}catch(e){report.state='stopped_for_review';report.error=e.message;save();process.exitCode=1;}
