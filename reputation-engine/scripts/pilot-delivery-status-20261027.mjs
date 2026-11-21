import {db,fs} from './gta-email-recovery-runtime.mjs';
import {sesFailureClass} from '../lib/partnership-core/ses-failure-classification.mjs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const files=['first-reviewed-admission.json',...fs.readdirSync(dir).filter(n=>/^additional-reviewed-.*\.json$/.test(n))];
const ids=[...new Set(files.flatMap(n=>JSON.parse(fs.readFileSync(dir+n,'utf8')).records||[]).filter(r=>r.jobId).map(r=>r.jobId))];
async function fetchChunks(table,key,values,select){
 const out=[];
 for(let i=0;i<values.length;i+=60){
  for(let offset=0;;offset+=1000){
   if(offset>=100000)throw Error('Status event pagination limit reached; no partial totals');
   const page=await db(table,{[key]:'in.('+values.slice(i,i+60).join(',')+')',select,order:table==='prepared_email_dispatches'?'job_id.asc':'id.asc',offset:String(offset),limit:'1000'});
   out.push(...page);if(page.length<1000)break;
  }
 }
 return out;
}
const jobs=await fetchChunks('sequence_jobs','id',ids,'id,status,error,contact_id');
const dispatches=await fetchChunks('prepared_email_dispatches','job_id',ids,'job_id,state,message_id,provider,accepted_at');
const messageIds=dispatches.map(d=>d.message_id).filter(Boolean);
const rawEvents=await fetchChunks('email_provider_events','provider_message_id',messageIds,'provider_message_id,event_type,occurred_at,payload');
const events=rawEvents.map(({payload,...event})=>({...event,failureClass:sesFailureClass({...event,payload})}));
const adverse=new Set(events.filter(e=>['email_bounced','email_complained','email_rejected'].includes(e.event_type)).map(e=>e.provider_message_id));
const delivered=new Set(events.filter(e=>e.event_type==='email_delivered'&&!adverse.has(e.provider_message_id)).map(e=>e.provider_message_id));
const result={at:new Date().toISOString(),queuedTotal:ids.length,pending:jobs.filter(j=>j.status==='pending').length,running:jobs.filter(j=>j.status==='running').length,failed:jobs.filter(j=>j.status==='failed').length,providerAccepted:dispatches.filter(d=>d.state==='accepted').length,providerDelivered:delivered.size,jobs,dispatches,events};
result.failureBreakdown=Object.fromEntries(['validation_blocked','suppression_blocked','delivery_bounced','bounce_unclassified'].map(kind=>[kind,new Set(events.filter(e=>e.failureClass===kind).map(e=>e.provider_message_id)).size]));
// Only pilot dispatch IDs are queried: owned synthetic tests are excluded.
// Image fetches and link requests are signals, not confirmed human actions.
result.engagementSignals={messagesWithOpenSignal:new Set(events.filter(e=>e.event_type==='email_opened').map(e=>e.provider_message_id)).size,messagesWithClickSignal:new Set(events.filter(e=>e.event_type==='email_clicked').map(e=>e.provider_message_id)).size,humanEngagementConfirmed:false};
fs.writeFileSync(dir+'live-pilot-status.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,jobs:undefined,dispatches:undefined,events:undefined},null,2));
