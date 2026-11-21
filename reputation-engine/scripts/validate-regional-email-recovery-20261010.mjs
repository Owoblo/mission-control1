import {fs,api} from './gta-email-recovery-runtime.mjs';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {SESv2Client,GetEmailAddressInsightsCommand,GetSuppressedDestinationCommand} from '@aws-sdk/client-sesv2';
const dir='artifacts/other-region-email-audit-20261010';
const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const addresses=new Set();
for(const market of ['saturn','ottawa']){
 const mailbox=await openZohoMailbox(market);
 let cached;
 const cachePath=dir+'/mailbox-'+market+'.json';
 if(market==='saturn'&&fs.existsSync(cachePath))cached=JSON.parse(fs.readFileSync(cachePath));
 if(cached?.complete&&Date.now()-Date.parse(cached.at)<3600000){
  const latest=await mailbox.request(`/accounts/${mailbox.accountId}/messages/view?start=1&limit=200&includeto=true&threadedMails=false`);
  if(!Array.isArray(latest)||(latest.length===200&&Number(latest.at(-1).receivedTime)>Date.parse(cached.at)))throw Error('Cached mailbox incremental gap');
  for(const m of [...cached.rows,...latest])for(const value of [m.fromAddress,m.toAddress,m.ccAddress])for(const e of String(value||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[])addresses.add(e.toLowerCase());
  console.log(JSON.stringify({mailbox:market,cachedMessages:cached.rows.length,incrementalChecked:true}));continue;
 }
 if(market==='ottawa'){
  const rows=[];
  for(const p of candidates.filter(p=>p.region==='Ottawa'))for(const searchKey of ['sender:'+p.email,'in:Sent::to:'+p.email]){
   const page=await mailbox.request(`/accounts/${mailbox.accountId}/messages/search?`+new URLSearchParams({searchKey,start:'1',limit:'200',includeto:'true'}));
   if(!Array.isArray(page)||page.length===200)throw Error('Ottawa search incomplete');rows.push(...page);await new Promise(r=>setTimeout(r,1500));
  }
  for(const m of rows)for(const value of [m.fromAddress,m.toAddress,m.ccAddress])for(const e of String(value||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[])addresses.add(e.toLowerCase());
  fs.writeFileSync(cachePath,JSON.stringify({at:new Date().toISOString(),complete:true,scope:'Candidate sender and Sent searches',candidateIds:candidates.filter(p=>p.region==='Ottawa').map(p=>p.id),rows}));
  console.log(JSON.stringify({mailbox:market,candidatesChecked:14,matchedMessages:rows.length}));continue;
 }
 const folders=await mailbox.request(`/accounts/${mailbox.accountId}/folders`);
 const rows=[];const scans=[{folderName:'All'},...folders.filter(f=>/^(sent|spam|trash)$/i.test(f.folderName))];
 for(const folder of scans){let complete=false;for(let start=1;start<=60001;start+=200){
  const page=await mailbox.request(`/accounts/${mailbox.accountId}/messages/view?`+new URLSearchParams({start:String(start),limit:'200',includeto:'true',threadedMails:'false',...(folder.folderId?{folderId:folder.folderId}:{})}));
  if(!Array.isArray(page))throw Error('Unreadable mailbox page');rows.push(...page);
  await new Promise(r=>setTimeout(r,1250));if(page.length<200){complete=true;break;}
 }if(!complete)throw Error('Mailbox scan incomplete');}
 const unique=[...new Map(rows.map(r=>[r.messageId,r])).values()];
 fs.writeFileSync(dir+'/mailbox-'+market+'.json',JSON.stringify({at:new Date().toISOString(),complete:true,rows:unique}));
 for(const m of unique)for(const value of [m.fromAddress,m.toAddress,m.ccAddress])for(const e of String(value||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[])addresses.add(e.toLowerCase());
 console.log(JSON.stringify({mailbox:market,messages:unique.length,complete:true}));
}
const results=[];
for(const p of candidates){const r={...p,checked_at:new Date().toISOString(),status:'held'};try{
 if(addresses.has(p.email))throw Error('existing_mailbox_correspondence');
 const context=await api('/api/marketing/contacts/'+p.id+'/context');
 if(!context.complete||context.ambiguousPhone||context.jobs?.length||context.events.some(e=>e.direction==='inbound'||e.channel==='email'||e.channel==='phone'||e.source!=='Partnerships'))throw Error('changed_shared_context');
 try{await ses.send(new GetSuppressedDestinationCommand({EmailAddress:p.email}));throw Error('ses_suppressed');}catch(e){if(e.name!=='NotFoundException')throw e;}
 const result=await ses.send(new GetEmailAddressInsightsCommand({EmailAddress:p.email}));const v=result.MailboxValidation,ev=v?.Evaluations||{};r.validation=v;r.validation_request_id=result.$metadata?.requestId;
 if(v?.IsValid?.ConfidenceVerdict!=='HIGH'||ev.HasValidSyntax?.ConfidenceVerdict!=='HIGH'||ev.HasValidDnsRecords?.ConfidenceVerdict!=='HIGH'||!['HIGH','MEDIUM'].includes(ev.MailboxExists?.ConfidenceVerdict)||['IsDisposable','IsRandomInput','IsRoleAddress'].some(k=>ev[k]?.ConfidenceVerdict!=='LOW'))throw Error('invalid_or_risky_email');
 r.mailbox_existence=ev.MailboxExists.ConfidenceVerdict;r.status='ready';r.mailbox_checked=true;
 }catch(e){r.reason=e.message;}results.push(r);fs.writeFileSync(dir+'/validation-results.json',JSON.stringify(results,null,2));
}
console.log(JSON.stringify({checked:results.length,ready:results.filter(r=>r.status==='ready').length,holds:results.filter(r=>r.status!=='ready').reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{})}));
