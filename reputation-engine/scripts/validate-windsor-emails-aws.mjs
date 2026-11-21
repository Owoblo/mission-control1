// SES recipient validation only: no SendEmail calls or account-wide setting changes.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {SESv2Client,GetEmailAddressInsightsCommand} from '@aws-sdk/client-sesv2';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';
const out=`${dir}/email-verification`;
const release=JSON.parse(await fs.readFile(`${dir}/priority-enrichment/personalized-release.json`));
const bulk=process.argv.includes('--directory');const recovery=process.argv.includes('--recovery');
if(bulk&&recovery)throw Error('Choose one validation scope');
const inputIndex=process.argv.indexOf('--input');const input=inputIndex>=0?process.argv[inputIndex+1]:null;
if(inputIndex>=0&&!input)throw Error('Missing input path');
const source=input?JSON.parse(await fs.readFile(input)):recovery?JSON.parse(await fs.readFile(`${dir}/send-release/recovery-validation-candidates.json`)):bulk?JSON.parse(execFileSync('python3',['-c','import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1])))))',`${dir}/deduplicated-email-routes.csv`],{encoding:'utf8'})).map(r=>r.email):[...release.initial,...release.secondary].map(r=>r.to);
const emails=[...new Set(source.map(e=>e.trim().toLowerCase()))];
if(emails.length>(input?100:recovery?100:bulk?794:13))throw Error('Batch size exceeds reviewed scope');
await fs.mkdir(out,{recursive:true});
const path=`${out}/aws-validation-results.jsonl`;
const existing=(await fs.readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e})).trim().split('\n').filter(Boolean).map(JSON.parse);
const latest=new Map(existing.map(r=>[r.email,r]));
const client=new SESv2Client({region:'us-east-2',maxAttempts:1});
const pending=emails.filter(e=>!latest.has(e));
console.log(JSON.stringify({scope:input?'explicit_input':recovery?'published_recovery':bulk?'directory':'personalized13',uniqueEmails:emails.length,cached:emails.length-pending.length,maxNewCalls:pending.length,maxPublishedApiCostUSD:pending.length*.01}));
for(const email of pending){
 let result;try{result=await client.send(new GetEmailAddressInsightsCommand({EmailAddress:email}));}catch(e){await fs.writeFile(`${out}/aws-validation-error.json`,JSON.stringify({at:new Date().toISOString(),email,error:e.name,message:e.message},null,2));throw e;}
 const validation=result.MailboxValidation;
 const check=validation?.Evaluations||{};
 const verdict=validation?.IsValid?.ConfidenceVerdict||'UNKNOWN';
 // LOW for IsDisposable means low evidence of risk; LOW for MailboxExists means low evidence of existence.
 const mailbox=check.MailboxExists?.ConfidenceVerdict||'UNKNOWN';
 const risk=['IsDisposable','IsRandomInput'].some(k=>check[k]?.ConfidenceVerdict==='HIGH');
 const status=risk?'hold_risk':verdict==='LOW'?'hold_low_confidence':verdict==='HIGH'&&mailbox==='HIGH'?'high_confidence_mailbox':'review_uncertain';
 const row={email,checked_at:new Date().toISOString(),provider:'aws_ses',region:'us-east-2',overall:verdict,mailbox,roleAddress:check.IsRoleAddress?.ConfidenceVerdict||'UNKNOWN',status,raw:validation,request_id:result.$metadata?.requestId,send_ready:false};
 await fs.appendFile(path,JSON.stringify(row)+'\n');latest.set(email,row);
 if(pending.indexOf(email)%50===49)console.log(JSON.stringify({completed:pending.indexOf(email)+1,total:pending.length}));
 await new Promise(r=>setTimeout(r,110));
}
const rows=emails.map(e=>latest.get(e));const counts={};for(const r of rows)counts[r.status]=(counts[r.status]||0)+1;
const report={at:new Date().toISOString(),scope:input?'explicit_input':recovery?'published_recovery':bulk?'directory':'personalized13',addresses:emails.length,counts,newCalls:pending.length,publishedApiCostUSD:pending.length*.01,prospectsSent:0,rows};
await fs.writeFile(`${out}/aws-${input?'explicit-input':recovery?'recovery':bulk?'directory':'personalized'}-summary.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,rows:undefined}));
