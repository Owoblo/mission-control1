/** Idempotent, narrowly scoped containment for the 17 malformed fresh-review jobs.
 * Default is read-only; --apply pauses their contacts and cancels only pending jobs.
 * Never calls a send endpoint or retries an ambiguous provider state.
 */
import '../gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {db} from '../reply-runtime-20261015.mjs';

const root='artifacts/partnership-pilot-3000-20261027';
const reconciliation=JSON.parse(fs.readFileSync(path.join(root,'fresh-copy-bug-reconciliation.json')));
if(reconciliation.affected!==17||reconciliation.rows.length!==17)throw Error('Unexpected incident scope');
const apply=process.argv.includes('--apply');
const records=[];
for(const row of reconciliation.rows){
 const admission=JSON.parse(fs.readFileSync(path.join(root,row.admissionFile)));
 const match=admission.records.find(r=>r.jobId===row.jobId);
 if(!match?.contactId)throw Error('Missing contact ID for '+row.jobId);
 const contacts=await db('market_contacts',{id:'eq.'+match.contactId,select:'id,email,sequence_paused,sequence_paused_reason,next_follow_up'});
 const jobs=await db('sequence_jobs',{contact_id:'eq.'+match.contactId,select:'*'});
 if(contacts.length!==1)throw Error('Contact lookup mismatch '+row.jobId);
 const initial=jobs.find(j=>j.id===row.jobId);
 if(!initial)throw Error('Initial job lookup mismatch '+row.jobId);
 if(initial.status==='running')throw Error('Ambiguous running initial job '+row.jobId);
 records.push({jobId:row.jobId,organisation:row.organisation,recipient:row.recipient,contactId:match.contactId,initialStatus:initial.status,providerEvents:row.providerEvents,sequencePaused:contacts[0].sequence_paused,pauseReason:contacts[0].sequence_paused_reason,nextFollowUp:contacts[0].next_follow_up,pendingJobs:jobs.filter(j=>j.status==='pending').map(j=>({id:j.id,kind:j.kind,scheduled_for:j.scheduled_for})),runningJobs:jobs.filter(j=>j.status==='running').map(j=>j.id)});
}
if(records.some(r=>r.runningJobs.length))throw Error('A contact has running jobs; stop and inspect provider state manually');
if(apply){
 for(const r of records){
  await db('market_contacts',{id:'eq.'+r.contactId},'PATCH',{sequence_paused:true,sequence_paused_reason:'malformed_copy_review_20261028',next_follow_up:null});
  for(const j of r.pendingJobs)await db('sequence_jobs',{id:'eq.'+j.id,status:'eq.pending'},'PATCH',{status:'cancelled',error:'Paused after malformed initial copy; no automatic follow-up or retry'});
 }
}
const result={at:new Date().toISOString(),mode:apply?'applied':'dry_run',affected:records.length,initialStatuses:Object.fromEntries([...new Set(records.map(r=>r.initialStatus))].map(s=>[s,records.filter(r=>r.initialStatus===s).length])),deliveryEvents:records.filter(r=>r.providerEvents.includes('email_delivered')).length,pendingJobs:records.reduce((n,r)=>n+r.pendingJobs.length,0),records};
const out=path.join(root,`fresh-copy-bug-containment-${apply?'applied':'dry-run'}.json`);
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({at:result.at,mode:result.mode,affected:result.affected,initialStatuses:result.initialStatuses,deliveryEvents:result.deliveryEvents,pendingJobs:result.pendingJobs,out}));
