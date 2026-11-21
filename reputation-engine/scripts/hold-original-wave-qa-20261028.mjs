import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs/promises';
const {db}=await import('./reply-runtime-20261015.mjs');

const targets=[
  ['a5ae9af6-010b-400a-b0b6-e1f89fd564a7','School of Continuing Studies, University of Toronto','learning-services mailbox'],
  ['edaed76b-30b6-45e6-8681-28f018371c16','Sky View Suites','reservations mailbox at related domain'],
  ['0bea11da-0c99-41a9-8b9c-0a15bf33188c','William G Davis Public School','student attendance mailbox'],
  ['c714bbca-a97e-4e9b-a4ad-d4bc5e0b8a48','shoptravel','customer support mailbox'],
  ['d45a0e8c-4bbd-48dd-b499-670b1b609c62','E3 Works','recruiting resumes mailbox'],
  ['9de3815f-1bc0-4018-be9f-7b6f7d77d26b','World Team Canada','donor services mailbox'],
  ['123517d8-8aad-4f21-8cea-7bd852f49d0d','Tundra Books','parent organisation HR mailbox'],
];
if(process.argv.includes('--extras-only')) targets.length=0;
if(process.argv.includes('--extras')||process.argv.includes('--extras-only')) targets.push(
  ['d7484cbe-319b-40bf-b5c1-0bef26655730','Skyview Pool and Spa','sales quotes mailbox'],
  ['355c8cd5-1fa2-4060-99c6-11ec6ef67335','Highland National Leasing','cross-domain mailbox attribution unproven'],
  ['8d7d664f-ede9-4b03-a59c-3871ae6bda13','On the Farm / Michelle Roy','personal appointment mailbox attribution weak'],
  ['7a733caa-5c75-4641-9cff-4e557159ee0f',"Roulston's Pharmacy",'pharmacy prescription mailbox'],
  ['ba6c1cc4-9759-4b98-baec-0814edaa5fa7','The Blackened Bristle','email appears to belong to another business'],
  ['81a98d80-e067-4133-8760-bedc75f64e90','Punjabi By Nature','catering-specific mailbox'],
  ['bbc12f1f-1a5a-4bad-8d55-9ee2e45fc261','Mermaid Luxury','Mississauga mailbox for Burlington candidate'],
  ['c13dac7a-02fb-4e3e-b876-c6f716e95a70','All-Lift Ltd','lift truck sales mailbox'],
  ['65bdc6a9-6d0a-4d91-ad09-8425330ae287','Avidbots Corp','Australia/New Zealand sales mailbox'],
);
const out=[];
for(const [id,organisation,reason] of targets){
  const [job]=await db('sequence_jobs',{id:'eq.'+id});
  if(!job){out.push({id,organisation,reason,outcome:'missing_job'});continue}
  const actionKey=job.email_payload?.actionKey||job.email_payload?.action_key||null;
  const [dispatches,requests,contact,touches]=await Promise.all([
    db('prepared_email_dispatches',{job_id:'eq.'+id}),
    actionKey?db('crm_email_requests',{request_key:'eq.prepared-email:'+actionKey}):Promise.resolve([]),
    db('market_contacts',{id:'eq.'+job.contact_id}),
    db('market_touches',{contact_id:'eq.'+job.contact_id,channel:'eq.email',direction:'eq.outbound',limit:'20'}),
  ]);
  const attempts=[];
  for(const request of requests) attempts.push(...await db('crm_email_attempts',{request_id:'eq.'+request.id}));
  const receipts=job.email_payload?.recipient?await db('crm_email_receipts',{recipient:'eq.'+job.email_payload.recipient,order:'occurred_at.desc',limit:'20'}):[];
  const p={id,organisation,reason,job_status:job.status,contact_id:job.contact_id,dispatch_states:dispatches.map(x=>x.state||x.status||null),request_states:requests.map(x=>x.status||x.state||null),attempt_count:attempts.length,receipt_count:receipts.length,outbound_touch_count:touches.length,provider_ids:[...new Set([...dispatches,...requests,...attempts,...receipts,...touches].flatMap(x=>[x.provider_message_id,x.message_id,x.metadata?.provider_message_id]).filter(Boolean))].length};
  const providerAmbiguity=attempts.length>0||receipts.length>0||touches.length>0||p.provider_ids>0||dispatches.some(x=>!['queued','ready','pending','held','cancelled',null].includes(x.state||x.status||null));
  if(process.argv.includes('--apply')){
    if(contact.length===1&&!contact[0].sequence_paused){
      const updated=await db('market_contacts',{id:'eq.'+job.contact_id},'PATCH',{sequence_paused:true,sequence_paused_reason:'qa_wrong_role_mailbox',next_follow_up:null});
      p.followup_paused=updated.length===1;
    } else p.followup_paused=contact.length===1&&contact[0].sequence_paused===true;
    if(job.status==='pending'&&!providerAmbiguity){
      const updated=await db('sequence_jobs',{id:'eq.'+id,status:'eq.pending'},'PATCH',{status:'cancelled',error:'QA hold: wrong role mailbox; '+reason});
      p.outcome=updated.length===1?'unsent_job_cancelled':'status_changed_no_mutation';
    }else p.outcome=providerAmbiguity?'provider_ambiguity_no_job_mutation':'job_not_pending';
  } else p.outcome=providerAmbiguity?'review_provider_ambiguity':job.status==='pending'?'safe_to_cancel':'already_terminal_or_sent';
  out.push(p);
}
const file='artifacts/partnership-pilot-3000-20261027/original-wave-qa-'+(process.argv.includes('--extras-only')?'extras-hold':process.argv.includes('--extras')?'extras-audit':'hold')+'-20261028.json';
await fs.writeFile(file,JSON.stringify({at:new Date().toISOString(),mode:process.argv.includes('--apply')?'apply':'audit',targets:out},null,2));
console.log(JSON.stringify({file,targets:out}));
