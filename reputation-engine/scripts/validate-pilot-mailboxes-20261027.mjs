// Explicitly bounded validation only. No send APIs and no live contact mutations.
import fs from 'node:fs';
import {SESv2Client,GetEmailAddressInsightsCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const dir='artifacts/partnership-pilot-3000-20261027';
const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
const file=dir+'/ses-mailbox-validation.jsonl',attemptFile=dir+'/ses-validation-attempts.jsonl';
const read=f=>fs.existsSync(f)?fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
const results=read(file),attempted=new Set(read(attemptFile).map(r=>r.email));
const todo=candidates.filter(r=>!attempted.has(r.email));let index=0;
const client=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
let errors=0;const startedAt=new Date().toISOString();
function summary(){const counts={};for(const r of results)counts[r.review_status]=(counts[r.review_status]||0)+1;
 const s={startedAt,updatedAt:new Date().toISOString(),selected:3000,attempts:attempted.size,results:results.length,counts,campaignReady:0,sent:0,maximum_base_validation_cost_usd:30,notes:'Mailbox evidence only. Generic role addresses are flagged separately, not automatically treated as bad mailboxes. Permission/identity checks remain required.'};
 fs.writeFileSync(dir+'/ses-validation-progress.json',JSON.stringify(s,null,2));return s;}
await Promise.all(Array.from({length:3},async()=>{
 while(index<todo.length&&attempted.size<3000&&errors<10){const row=todo[index++];if(attempted.has(row.email))continue;
 attempted.add(row.email);fs.appendFileSync(attemptFile,JSON.stringify({email:row.email,at:new Date().toISOString()})+'\n');
 let record={email:row.email,organisation_id:row.organisation_id,checked_at:new Date().toISOString()};
 try{const r=await client.send(new GetEmailAddressInsightsCommand({EmailAddress:row.email}),{abortSignal:AbortSignal.timeout(20000)});
 const v=r.MailboxValidation,e=v?.Evaluations||{};
 const positive=v?.IsValid?.ConfidenceVerdict==='HIGH'&&e.HasValidSyntax?.ConfidenceVerdict==='HIGH'&&e.HasValidDnsRecords?.ConfidenceVerdict==='HIGH'&&['HIGH','MEDIUM'].includes(e.MailboxExists?.ConfidenceVerdict)&&['IsDisposable','IsRandomInput'].every(k=>e[k]?.ConfidenceVerdict==='LOW');
 record={...record,review_status:positive?'mailbox_checks_passed_eligibility_pending':'mailbox_review_required',validation:v,request_id:r.$metadata?.requestId};
 }catch(e){errors++;record={...record,review_status:'validation_error_requires_review',error:e.name};}
 results.push(record);fs.appendFileSync(file,JSON.stringify(record)+'\n');summary();
 if(results.length%100===0)console.log(JSON.stringify(summary()));
 await new Promise(r=>setTimeout(r,350));
 }
}));console.log(JSON.stringify(summary()));
