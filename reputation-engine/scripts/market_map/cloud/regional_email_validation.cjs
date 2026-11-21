// Bounded mailbox insights only. No SendEmail import, CRM mutation, or outreach.
const fs=require('node:fs');const {SESv2Client,GetEmailAddressInsightsCommand}=require('@aws-sdk/client-sesv2');
const root='/data/research/artifacts/regional-contact-enrichment-20261104';
const read=(p,fallback)=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;
const save=(p,v)=>{fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2));fs.renameSync(p+'.tmp',p)};
async function main(){
 const lock=root+'/email-validation-pilot.lock';const fd=fs.openSync(lock,'wx');fs.writeSync(fd,String(process.pid));fs.closeSync(fd);process.on('exit',()=>{try{fs.unlinkSync(lock)}catch{}});
 const manifest=read(root+'/email-validation-pilot.json');
 if(manifest.send_authorized!==false||manifest.maximum_new_requests!==100||manifest.emails.length>100||new Set(manifest.emails).size!==manifest.emails.length)throw Error('Invalid pilot scope');
 const secret=read('/data/research/.private/regional-email-validation.json');
 const client=new SESv2Client({region:secret.region,credentials:{accessKeyId:secret.accessKeyId,secretAccessKey:secret.secretAccessKey,...(secret.sessionToken?{sessionToken:secret.sessionToken}:{})},maxAttempts:1});
 const cache=read(root+'/email-validation-pilot-results.json',{});let errors=0;
 for(const email of manifest.emails){
  if(cache[email])continue;
  cache[email]={email,checked_at:new Date().toISOString(),state:'request_reserved_no_blind_retry',send_ready:false};save(root+'/email-validation-pilot-results.json',cache);
  try{
   const r=await client.send(new GetEmailAddressInsightsCommand({EmailAddress:email}),{abortSignal:AbortSignal.timeout(20000)});const v=r.MailboxValidation,e=v?.Evaluations||{};
   const strong=v?.IsValid?.ConfidenceVerdict==='HIGH'&&['HasValidSyntax','HasValidDnsRecords','MailboxExists'].every(k=>e[k]?.ConfidenceVerdict==='HIGH')&&['IsDisposable','IsRandomInput'].every(k=>e[k]?.ConfidenceVerdict==='LOW');
   cache[email]={...cache[email],state:strong?'mailbox_checks_passed_identity_review_pending':'mailbox_review_required',validation:v,request_id:r.$metadata?.requestId};
  }catch(e){cache[email]={...cache[email],state:'validation_error_requires_review',error:e.name};errors++;}
  save(root+'/email-validation-pilot-results.json',cache);
  save(root+'/email-validation-pilot-status.json',{checked_at:new Date().toISOString(),state:errors>=3?'provider_error_hold':'running',attempted:Object.keys(cache).length,passed:Object.values(cache).filter(r=>r.state==='mailbox_checks_passed_identity_review_pending').length,errors,send_ready:0,messages_sent:0,owner_send_hold:true});
  if(errors>=3)return;
  await new Promise(r=>setTimeout(r,350));
 }
 save(root+'/email-validation-pilot-status.json',{checked_at:new Date().toISOString(),state:'completed_for_identity_review',attempted:Object.keys(cache).length,passed:Object.values(cache).filter(r=>r.state==='mailbox_checks_passed_identity_review_pending').length,errors,send_ready:0,messages_sent:0,owner_send_hold:true});
}
main().catch(e=>{save(root+'/email-validation-pilot-status.json',{checked_at:new Date().toISOString(),state:'held',error:e.name,send_ready:0,messages_sent:0});process.exitCode=1});
