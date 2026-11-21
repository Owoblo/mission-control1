// Read-only operational report. Does not send, retry, resume, or change mailboxes.
import fs from 'node:fs';
import {db} from './gta-email-recovery-runtime.mjs';
import {summarizeMailEvidence} from './mail-scorecard-core.mjs';
const now=new Date().toISOString();
const since=new Date(Date.parse(now)-86400000).toISOString();
async function all(table,query) {
  const rows=[];
  for(let offset=0;offset<100000;offset+=500) {
    const batch=await db(table,{...query,limit:'500',offset:String(offset)});
    rows.push(...batch);
    if(batch.length<500)return rows;
  }
  throw Error(`${table}: report limit reached; refusing to publish partial totals`);
}
const [requests,attempts,receipts,replies,contacts,senders,domains,dispatches,unresolved,suppressions]=await Promise.all([
  all('crm_email_requests',{select:'id,purpose,recipients,context',created_at:'gte.'+since,order:'id'}),
  all('crm_email_attempts',{select:'id,request_id,state,provider_message_id,created_at',created_at:'gte.'+since,order:'id'}),
  all('crm_email_receipts',{select:'event_key,provider_message_id,recipient,event_type,attempt_id',sent_at:'gte.'+since,order:'event_key'}),
  all('market_touches',{select:'id,contact_id,metadata',channel:'eq.email',direction:'eq.inbound',created_at:'gte.'+since,order:'id'}),
  all('market_contacts',{select:'id,tags',order:'id'}),
  all('email_sender_accounts',{select:'from_email,status,daily_cap,provider',provider:'eq.ses',order:'id'}),
  all('crm_email_domains',{select:'domain,status,daily_cap,pause_reason',order:'domain'}),
  all('prepared_email_dispatches',{select:'action_key,job_id,state,message_id,created_at',state:'in.(dispatching,ambiguous)',order:'action_key'}),
  all('crm_email_attempts',{select:'id,state,provider_message_id,created_at',or:`(state.eq.unknown,and(state.in.(prepared,dispatching),created_at.lt.${new Date(Date.parse(now)-300000).toISOString()}))`,order:'id'}),
  all('crm_email_suppressions',{select:'recipient,reason',created_at:'gte.'+since,order:'recipient'}),
]);
// Fetch parents outside the reporting window without expanding the send window.
for(const a of attempts) if(!requests.some(r=>r.id===a.request_id))requests.push(...await db('crm_email_requests',{select:'id,purpose,recipients,context',id:'eq.'+a.request_id}));
let warmup={status:'unavailable',checkedAt:null};
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const warmupPath=new URL(`../artifacts/mailivery-warmup/${date}.json`,import.meta.url);
if(fs.existsSync(warmupPath)) {
 const snapshot=JSON.parse(fs.readFileSync(warmupPath,'utf8'));
 warmup={status:Date.parse(snapshot.checkedAt)>Date.parse(now)-900000?'recent':'stale',...snapshot};
}
const report={checkedAt:now,window:{from:since,to:now,type:'rolling 24 hours'},
 ...summarizeMailEvidence({requests,attempts,receipts,replies,contacts,now}),senders,domains,warmup,
 unresolvedTransportAttempts:unresolved,unresolvedPreparedDispatches:dispatches,
 newSuppressions:suppressions.length,
 gates:{readOnly:true,outreachDomainsPaused:domains.filter(d=>d.domain==='saturnstarmovers.ca').every(d=>d.status==='paused') && domains.some(d=>d.domain==='saturnstarmovers.ca'),
 friendPlacement:'Not queried by this report; obtain the recipient’s folder report separately',
 recovery:'Unresolved sends remain held; no automatic retries',combinedWarmupOutreachBudget:'External warm-up is not yet reconciled against CRM limits'}};
const directory=new URL('../artifacts/mail-scorecard/',import.meta.url);fs.mkdirSync(directory,{recursive:true});
const path=new URL('latest.json',directory);fs.writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
