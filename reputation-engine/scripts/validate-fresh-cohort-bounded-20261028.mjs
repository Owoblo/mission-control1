// Bounded GetEmailAddressInsights only; no sending or CRM mutations.
import fs from 'node:fs';import path from 'node:path';
import {SESv2Client,GetEmailAddressInsightsCommand} from '@aws-sdk/client-sesv2';
import {loadFreshCohortBundle,usableMailboxReceipt,highMailboxEvidence} from '../lib/partnership-core/fresh-cohort-bundle.mjs';
const root=process.argv[2];if(!root)throw Error('Usage: node scripts/validate-fresh-cohort-bounded-20261028.mjs BATCH_ROOT [--run]');
const {manifest,candidates,manifestHash}=loadFreshCohortBundle(root);
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
const file=path.join(root,'ses-mailbox-validation.jsonl'),attemptFile=path.join(root,'ses-validation-attempts.jsonl');
const priorRoot='artifacts/partnership-pilot-3000-20261027';
const siblingRoots=fs.readdirSync(path.dirname(root),{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(path.join(path.dirname(root),e.name,'batch-manifest.json'))).map(e=>path.join(path.dirname(root),e.name));
const local=read(file),cache=[...read(priorRoot+'/ses-mailbox-validation.jsonl'),...siblingRoots.flatMap(r=>read(path.join(r,'ses-mailbox-validation.jsonl')))];
const attempts=new Set([...read(priorRoot+'/ses-validation-attempts.jsonl'),...siblingRoots.flatMap(r=>read(path.join(r,'ses-validation-attempts.jsonl')))].map(x=>x.email.toLowerCase()));
const current=new Set(local.map(x=>x.email.toLowerCase()));
let paid=0,reused=0,ambiguous=0,errors=0;
const summary=()=>({at:new Date().toISOString(),manifestHash,selected:candidates.length,new_paid_requests:paid,reused,unrepeated_prior_attempts:ambiguous,errors,campaign_ready:0,sent:0});
if(!process.argv.includes('--run')){console.log(JSON.stringify({...summary(),mode:'plan',maximum_new_paid_requests:manifest.maximum_new_paid_requests}));process.exit(0)}
const sharedLock=path.join(path.dirname(root),'fresh-validation.lock');const sharedFd=fs.openSync(sharedLock,'wx');fs.closeSync(sharedFd);process.on('exit',()=>{try{fs.unlinkSync(sharedLock)}catch{}});
const lock=fs.openSync(path.join(root,'validation.lock'),'wx');fs.closeSync(lock);process.on('exit',()=>{try{fs.unlinkSync(path.join(root,'validation.lock'))}catch{}});
process.loadEnvFile('.env.ses.local');const client=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
function append(file,row){const fd=fs.openSync(file,'a');try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
let index=0;
await Promise.all(Array.from({length:3},async()=>{while(index<candidates.length&&errors<10){const c=candidates[index++],email=c.email.toLowerCase();if(current.has(email))continue;
 const hit=cache.filter(r=>r.email.toLowerCase()===email&&usableMailboxReceipt(r)).at(-1);
 if(hit){append(file,{...hit,organisation_id:c.organisation_id,reused_receipt:true});reused++;current.add(email);continue;}
 if(attempts.has(email)){ambiguous++;continue;}
 if(paid>=manifest.maximum_new_paid_requests)break;
 paid++;attempts.add(email);append(attemptFile,{email,at:new Date().toISOString(),manifestHash,state:'reserved_no_automatic_retry'});
 let record={email,organisation_id:c.organisation_id,checked_at:new Date().toISOString(),manifestHash};
 try{const response=await client.send(new GetEmailAddressInsightsCommand({EmailAddress:email}),{abortSignal:AbortSignal.timeout(20000)});record={...record,validation:response.MailboxValidation,review_status:highMailboxEvidence(response.MailboxValidation)?'mailbox_checks_passed_eligibility_pending':'mailbox_review_required',request_id:response.$metadata?.requestId};}
 catch(e){errors++;record={...record,review_status:'validation_error_requires_review',error:e.name,error_code:e.code||null,request_id:e.$metadata?.requestId||null};}
 append(file,record);current.add(email);fs.writeFileSync(path.join(root,'validation-progress.json'),JSON.stringify(summary(),null,2));await new Promise(r=>setTimeout(r,350));
}}));fs.writeFileSync(path.join(root,'validation-progress.json'),JSON.stringify(summary(),null,2));console.log(JSON.stringify(summary()));
