// Bounded GetEmailAddressInsights only. No email transport or CRM mutation.
const fs=require('node:fs'),dns=require('node:dns').promises;
const folder=process.argv[2],cap=Number(process.argv[3]);
const read=(p,f)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;
const save=(p,v)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2));fs.renameSync(p+'.tmp',p)};
const base='/data/research/artifacts/regional-contact-enrichment-20261104';
async function main(){
 if(!Number.isInteger(cap)||cap<0||cap>20)throw Error('Unreviewed mailbox cap');
 const items=read(folder+'/review-queue.json',{items:[]}).items;
 const emails=[...new Set(items.flatMap(x=>x.routes).filter(x=>x.type==='email').map(x=>x.value.toLowerCase()))];
 const cacheFile='/data/research/artifacts/daily-preparation-20261118/mailbox-cache.json';
 const shared=read(cacheFile,{}),previous={...read(base+'/email-validation-pilot-results.json',{}),...shared},file=folder+'/mailbox-checks.json';
 const result=read(file,{at:new Date().toISOString(),new_attempts:0,errors:0,rows:{},messages_sent:0,send_ready:0});
 const lock='/data/research/artifacts/daily-preparation-20261118/mailbox-provider.lock';const fd=fs.openSync(lock,'wx');fs.writeSync(fd,String(process.pid));fs.closeSync(fd);process.on('exit',()=>{try{fs.unlinkSync(lock)}catch{}});
 const phones=[...new Set(items.flatMap(x=>x.routes).filter(x=>x.type==='phone').map(x=>x.value))];
 const carrier=read(base+'/carrier-lookups.json',{}),current=read('/data/research/artifacts/partnership-enrichment-20261118/route-verification.json',{}).phones||{};
 result.phones={};
 for(const phone of phones){const recent=[current[phone],carrier[phone]].filter(Boolean).filter(x=>{const age=Date.now()-Date.parse(x.checked_at);return age>=0&&age<86400000}).sort((a,b)=>Date.parse(b.checked_at)-Date.parse(a.checked_at))[0];result.phones[phone]={phone,state:recent?'fresh_carrier_receipt_reused_review_pending':'carrier_verification_required',receipt:recent?.data?{checked_at:recent.checked_at,valid_number:recent.data.valid_number,country:recent.data.country_code,type:recent.data.carrier?.type,raw_receipt:recent}:recent||null,sms_permission_verified:false,send_ready:false}}
 let client,Command;delete result.provider_setup_hold;
 try{const sdk=require('/data/research/artifacts/daily-preparation-20261118/node-deps/node_modules/@aws-sdk/client-sesv2');Command=sdk.GetEmailAddressInsightsCommand;const s=read('/data/research/.private/regional-email-validation.json');client=new sdk.SESv2Client({region:s.region,credentials:{accessKeyId:s.accessKeyId,secretAccessKey:s.secretAccessKey,...(s.sessionToken?{sessionToken:s.sessionToken}:{})},maxAttempts:1})}catch(e){result.provider_setup_hold=e.name}
 for(const email of emails){
  if(result.rows[email]&&result.rows[email].mailbox_status!=='verification_deferred')continue;
  const row={email,checked_at:new Date().toISOString(),mailbox_status:'unknown',send_ready:false};
  try{row.mx=await dns.resolveMx(email.split('@')[1]);row.domain_state=row.mx.length&&!row.mx.some(x=>!x.exchange||x.exchange==='.')?'mx_present':'no_usable_mx'}catch(e){row.domain_state='dns_review_required';row.dns_error=e.code}
  const old=previous[email],age=Date.now()-Date.parse(old?.checked_at);
  if(old&&old.mailbox_status!=='verification_deferred'&&age>=0&&age<7*86400000){row.saved_provider_receipt=old;row.mailbox_status=old.mailbox_status||old.state;row.evidence_reused=true}
  else if(client&&row.domain_state==='mx_present'&&result.new_attempts<cap&&result.errors<3){
   // Reservation persisted before the one-shot provider call. No blind retries.
   result.new_attempts++;row.mailbox_status='request_reserved_no_blind_retry';result.rows[email]=row;save(file,result);if(row.mailbox_status!=='verification_deferred'){shared[email]=row;save(cacheFile,shared)};
   try{const r=await client.send(new Command({EmailAddress:email}),{abortSignal:AbortSignal.timeout(20000)});const v=r.MailboxValidation,e=v?.Evaluations||{};row.validation=v;row.request_id=r.$metadata?.requestId;row.mailbox_status=v?.IsValid?.ConfidenceVerdict==='HIGH'&&['HasValidSyntax','HasValidDnsRecords','MailboxExists'].every(k=>e[k]?.ConfidenceVerdict==='HIGH')&&['IsDisposable','IsRandomInput'].every(k=>e[k]?.ConfidenceVerdict==='LOW')?'provider_checks_passed_identity_review_pending':'provider_review_required'}catch(e){row.mailbox_status='provider_error_hold';row.error=e.name;result.errors++}
  }else if(!row.evidence_reused)row.mailbox_status='verification_deferred';
  result.rows[email]=row;save(file,result);if(row.mailbox_status!=='verification_deferred'){shared[email]=row;save(cacheFile,shared)};
 }
 result.state='completed_with_release_holds';save(file,result);console.log(JSON.stringify({state:result.state,emails:emails.length,new_attempts:result.new_attempts,errors:result.errors,provider_setup_hold:result.provider_setup_hold,send_ready:0}));
}
main().catch(e=>{save(folder+'/mailbox-error.json',{at:new Date().toISOString(),error:e.name,messages_sent:0});process.exitCode=1});
