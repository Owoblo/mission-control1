import {fs,api} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/other-region-email-audit-20261010';
const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
fs.mkdirSync(dir+'/context-checks',{recursive:true});
let cursor=0;
async function worker(){while(cursor<candidates.length){const p=candidates[cursor++];
 const result={...p,checkedAt:new Date().toISOString(),status:'review_candidate',reasons:[]};
 try{const context=await api('/api/marketing/contacts/'+p.id+'/context');
 if(!context.complete||context.ambiguousPhone)result.reasons.push('incomplete_or_ambiguous_shared_context');
 if(context.jobs?.length)result.reasons.push('sales_job_context');
 if(context.events?.some(e=>e.direction==='inbound'))result.reasons.push('shared_context_inbound');
 if(context.events?.some(e=>e.channel==='email'))result.reasons.push('shared_context_email_history');
 if(context.events?.some(e=>e.channel==='phone'||e.source!=='Partnerships'))result.reasons.push('call_or_other_channel_context');
 result.contextGeneratedAt=context.generatedAt;
 }catch(e){result.reasons.push('lookup_incomplete:'+e.message);}
 if(result.reasons.length)result.status='held_for_review';
 fs.writeFileSync(dir+'/context-checks/'+p.id+'.json',JSON.stringify(result,null,2));
}}
const results=await Promise.allSettled([worker(),worker(),worker()]);for(const r of results)if(r.status==='rejected')throw r.reason;
const checks=candidates.map(p=>JSON.parse(fs.readFileSync(dir+'/context-checks/'+p.id+'.json')));
fs.writeFileSync(dir+'/context-results.json',JSON.stringify(checks,null,2));
const summary=JSON.parse(fs.readFileSync(dir+'/summary.json'));
summary.contextCheckedAt=new Date().toISOString();summary.afterSharedContext=checks.filter(r=>r.status==='review_candidate').length;
for(const [region,row]of Object.entries(summary.regions))row.afterSharedContext=checks.filter(r=>r.region===region&&r.status==='review_candidate').length;
summary.remainingChecks=['Full mailbox correspondence review','Current email verification and suppression checks','Region-specific sender and outreach policy review'];
summary.messagesSent=0;
fs.writeFileSync(dir+'/summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({checked:checks.length,afterSharedContext:summary.afterSharedContext,held:checks.filter(r=>r.status==='held_for_review').map(r=>({region:r.region,reasons:r.reasons})),regions:Object.fromEntries(Object.entries(summary.regions).filter(([,r])=>r.nonresponders))},null,2));
