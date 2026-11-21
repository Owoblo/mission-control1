import './gta-email-recovery-runtime.mjs';
import {db,base,headers} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mailboxAdmissionQuality} from '../lib/partnership-core/mailbox-admission-quality.mjs';
import {indexedMailboxHistory} from '../lib/partnership-core/mailbox-history-index.mjs';
import {loadVerifiedFreshCohortBundle,highMailboxEvidence} from '../lib/partnership-core/fresh-cohort-bundle.mjs';
import {isOttawa} from '../lib/partnership-core/ottawa.mjs';
import {preparedEmailContentHash,validatePreparedEmail} from '../lib/partnership-core/prepared-email.mjs';
const dir='artifacts/partnership-pilot-3000-20261027';
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name,'utf8'));
const lines=name=>fs.readFileSync(dir+'/'+name,'utf8').trim().split('\n').map(JSON.parse);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const host=x=>{try{return new URL(String(x).includes('://')?x:'https://'+x).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}};
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
if(process.argv.includes('--help')){console.log('node scripts/admit-reviewed-pilot-batch-20261027.mjs --reviews PATH --output NAME.json [--candidate-root PATH] [--admit]');process.exit(0)}
const inputPath=arg('--reviews'),outputName=arg('--output');
const candidateRoot=arg('--candidate-root');
const bundle=candidateRoot?loadVerifiedFreshCohortBundle(path.resolve(candidateRoot)):null;
const evidenceManifestHash=bundle?.manifestHash||null;
const actionNamespace=bundle?'pilot-fresh-'+evidenceManifestHash:'pilot-3000-20261027';
const sourceTag=bundle?'pilot-fresh-reviewed-'+evidenceManifestHash:'pilot-3000-reviewed-20261027';
if(!inputPath||!outputName||path.basename(outputName)!==outputName||!/^additional-reviewed-[a-z0-9-]+\.json$/.test(outputName))throw Error('Provide --reviews PATH and --output additional-reviewed-NAME.json');
const inputText=fs.readFileSync(inputPath,'utf8');
const inputHash=createHash('sha256').update(inputText).digest('hex');
const reviews=inputText.trim().split('\n').filter(Boolean).map(JSON.parse);
if(new Set(reviews.map(r=>r.organisation_id)).size!==reviews.length)throw Error('Duplicate organisation IDs in input');
const outputPath=path.join(dir,outputName),journalPath=outputPath+'.journal.jsonl',lockPath=outputPath+'.lock';
const lock=fs.openSync(lockPath,'wx');fs.writeSync(lock,String(process.pid));fs.closeSync(lock);
process.on('exit',()=>{try{fs.unlinkSync(lockPath)}catch{}});
const previous=fs.existsSync(outputPath)?JSON.parse(fs.readFileSync(outputPath,'utf8')):null;
if(previous&&(previous.inputHash!==inputHash||(previous.evidenceManifestHash||null)!==evidenceManifestHash))throw Error('Existing output belongs to different input; use a new output name');
const byId=new Map((previous?.records||[]).map(r=>[r.organisation_id,r]));
// Mailbox calls are bounded, while recipient processing remains sequential so
// new CRM identities are immediately included in subsequent duplicate checks.
async function mapBounded(items,limit,fn){let next=0;const out=new Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i]);}}));return out;}
const historyText=fs.readFileSync(dir+'/mailbox-address-index.json','utf8');
const historyIndex=JSON.parse(historyText);
const historyEvidence={sha256:createHash('sha256').update(historyText).digest('hex'),startedAt:historyIndex.startedAt,completedAt:historyIndex.completedAt};
const regionalPhones={'gta':'437-465-0584','windsor':'226-887-0667','waterloo':'226-241-9853','london':'548-639-1428','ottawa':'548-290-8695'};
function reviewedIdentity(review,candidate){
 const city=review.reviewed_city,phone=review.regional_phone,region=review.sender_region;
 const ottawa=isOttawa(city);
 if(ottawa&&apply&&process.env.PREPARED_OTTAWA_EXECUTION_ENABLED!=='true')throw Error('Ottawa rollout held: confirmed-delivery telemetry and provider limits require verification');
 if(review.market!==(ottawa?'ottawa':'saturn')||(region==='ottawa')!==ottawa||!regionalPhones[region]||regionalPhones[region]!==phone)throw Error('Explicit reviewed market and matching regional phone required');
 const company=review.corrected_organisation_name||review.organisation_name;
 if(!city||!company||[city,company].some(v=>typeof v!=='string'||/[\r\n<>]/.test(v)))throw Error('Reviewed city/business identity missing or invalid');
 if(typeof review.proposed_contextual_paragraph!=='string'||!review.proposed_contextual_paragraph.trim()||/\b(?:undefined|null|nan)\b/i.test(review.proposed_contextual_paragraph)||typeof review.reviewed_sector!=='string'||!review.reviewed_sector.trim()||typeof review.finding!=='string'||!review.finding.trim()||!Array.isArray(review.sources)||!review.sources.length)throw Error('Individual source review/context incomplete or copy render invalid');
 if(review.requires_parent_account_review)throw Error('Parent-account context requires additional review');
 return {city,phone,company,market:ottawa?'ottawa':'saturn',firstName:ottawa?'Courage':'John',brand:ottawa?'Dexa Movers':'Saturn Star Movers',sender:ottawa?'Courage Eke <hello@dexamovers.ca>':'John Owolabi <john@saturnstarmovers.ca>',replyTo:ottawa?'hello@dexamovers.ca':'business@starmovers.ca'};
}
const candidates=bundle?.candidates||read('candidates.json');
const sources=bundle?.sources||lines('source-refresh.jsonl');
const technical=bundle?.technical||lines('role-inclusive-review.jsonl');
const mailbox=bundle?.mailbox||lines('ses-mailbox-validation.jsonl');
const apply=process.argv.includes('--admit');
const contacts=[];
for(let offset=0;;offset+=1000){
 if(offset>=100000)throw Error('CRM pagination limit; no admission');
 const rows=await db('market_contacts',{select:'*',order:'id',offset:String(offset),limit:'1000'});
 contacts.push(...rows);if(rows.length<1000)break;
}
const report={at:new Date().toISOString(),inputPath,inputHash,evidenceManifestHash,candidateRoot:candidateRoot||null,mode:apply?'admission':'review',selected:reviews.length,queued:0,held:0,sent:0,records:[]};
function save(record){
 byId.set(record.organisation_id,record);report.records=[...byId.values()];report.queued=report.records.filter(r=>['queued','already_admitted'].includes(r.state)).length;report.held=report.records.filter(r=>r.state==='held').length;report.updatedAt=new Date().toISOString();
 const fd=fs.openSync(journalPath,'a');try{fs.writeSync(fd,JSON.stringify({at:report.updatedAt,...record})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.writeFileSync(outputPath+'.tmp',JSON.stringify(report,null,2));fs.renameSync(outputPath+'.tmp',outputPath);
 console.log(JSON.stringify({organisation:record.organisation,state:record.state,reason:record.reason,jobId:record.jobId}));
}
for(const review of reviews){
 const record={...byId.get(review.organisation_id),organisation_id:review.organisation_id,organisation:review.organisation_name,email:review.email};
 delete record.reason;
 try{
  const candidate=candidates.find(c=>c.organisation_id===review.organisation_id);
  if(!candidate||candidate.email.toLowerCase()!==review.email.toLowerCase())throw Error('Candidate recipient mismatch');
  if(/^(?:attendance|resumes?|recruit(?:ing|ment)?|hr|hrcanada|careers?|jobs?|donorservices|customersupport|reservations?|admissions?|billing|accounts?payable|privacy|abuse)@/i.test(review.email))throw Error('Special-purpose mailbox requires individual recipient review');
  const {city,phone,company,market,firstName,brand,sender,replyTo}=reviewedIdentity(review,candidate);
  const source=sources.find(c=>c.organisation_id===review.organisation_id);
  const tech=technical.find(c=>c.organisation_id===review.organisation_id);
  const validation=mailbox.find(c=>c.email.toLowerCase()===review.email.toLowerCase());
  if(review.identity_email_binding!=='pass'||review.role_relevance!=='pass_for_conditional_context'||!source?.target_email_observed||source.restriction_signals.length||tech?.technical_screen_status!=='advance_to_identity_and_eligibility_review')throw Error('Source, identity, relevance or technical review hold');
  if([source.checked_at,validation?.checked_at,review.reviewed_at].some(t=>!Number.isFinite(Date.parse(t))||Date.now()-Date.parse(t)>86400000||Date.parse(t)>Date.now()+60000))throw Error('Review evidence stale or timestamp invalid');
  if(source.email?.toLowerCase()!==review.email.toLowerCase()||!review.sources.some(s=>source.pages.some(p=>p.sha256===s.sha256&&(p.final_url===s.url||p.requested_url===s.url)&&p.target_email_observed)))throw Error('Reviewed source page/email binding missing');
  if(bundle&&(!highMailboxEvidence(validation?.validation)||validation?.organisation_id!==review.organisation_id||tech?.email?.toLowerCase()!==review.email.toLowerCase()||market==='ottawa'))throw Error('Fresh cohort verification or market binding hold');
  const phones=JSON.parse(candidate.phone_candidates||'[]').map(p=>p.replace(/\D/g,'').slice(-10));
  const matches=contacts.filter(c=>c.email?.toLowerCase()===review.email.toLowerCase()||(candidate.domain&&host(c.website)===candidate.domain)||norm(c.company)===norm(review.organisation_name)||norm(c.company)===norm(company)||(c.phone&&phones.includes(c.phone.replace(/\D/g,'').slice(-10))));
  const own=matches.filter(c=>c.source_csv===sourceTag&&c.email?.toLowerCase()===review.email.toLowerCase());
  // Individually audited existing records may be reused, never duplicated.
  const existingContact=review.reviewed_existing_contact_id&&matches.length===1&&matches[0].id===review.reviewed_existing_contact_id&&norm(matches[0].company)===norm(company)&&host(matches[0].website)===candidate.domain&&(!matches[0].email||matches[0].email.toLowerCase()===review.email.toLowerCase())?matches[0]:null;
  if(matches.length&&(own.length!==1||matches.length!==1)&&!existingContact)throw Error('Existing CRM identity/history requires individual review');
  const subject='Working with '+company;
  const text=`I wanted to personally introduce myself to you and the team at ${company}. My name is ${firstName}, and I run ${brand}, a local moving company serving ${city} and the surrounding areas.\n\n${review.proposed_contextual_paragraph.replaceAll('we would','we’d').replaceAll('We would','We’d')}\n\nWould it be okay if I sent over my digital card for you to keep on hand?\n\nYou can also reach me directly on ${phone}. I’m always happy to have a chat or arrange a meetup.\n\n${firstName}\n${brand}\n\nP.S. If you’d prefer I didn’t follow up, just reply “no thanks” and I’ll happily honour that.`;
  const actionKey=actionNamespace+':'+review.organisation_id;
  if(own[0]){
   const jobs=await db('sequence_jobs',{contact_id:'eq.'+own[0].id,template_key:'eq.prepared_email_v1',limit:'1000'});
   if(jobs.length===1000)throw Error('Job history requires pagination');
   const existing=jobs.filter(j=>j.email_payload?.actionKey===actionKey);
   if(existing.length>1)throw Error('Duplicate existing action requires reconciliation');
   if(existing.length===1){const job=existing[0],payload=job.email_payload;
    if(payload.recipient!==review.email||payload.contactId!==own[0].id||payload.contentHash!==preparedEmailContentHash(payload)||(payload.text!==text&&payload.text!=='Hi,\n\n'+text)||payload.subject!==subject)throw Error('Existing immutable queue payload differs; no overwrite');
    Object.assign(record,{state:'already_admitted',jobId:job.id,jobStatus:job.status,contactId:own[0].id,accountId:own[0].partner_company_id,payload});save(record);continue;
   }
  }
  if(review.review_method==='automated_evidence_rules_v1'){
   const quality=mailboxAdmissionQuality(validation?.validation);
   if(!quality.automatic)throw Error('Secondary mailbox verification required: '+quality.reason);
  }
  const mailHistory=indexedMailboxHistory(historyIndex,review.email,candidate.domain);
  if(mailHistory.length)throw Error('Existing mailbox correspondence requires individual review: '+JSON.stringify(mailHistory));
  const suppressed=await db('crm_email_suppressions',{recipient:'eq.'+review.email.toLowerCase(),limit:'2'});
  if(suppressed.length)throw Error('Suppressed recipient');
  record.subject=subject;record.text=text;record.city=city;record.phone=phone;
  record.publicationBasis={assessment:'supported_for_this_business_relevant_message',basis:'recipient_business_conspicuous_publication',sourceUrls:review.sources.map(s=>s.url),identityAndRoleReason:review.finding,messageRelevance:review.proposed_contextual_paragraph,restrictionReview:'No prohibition found in the inspected source pages; bounded review, not a claim of complete website coverage.',sourceCheckedAt:source.checked_at,sourceHash:sha(source)};
  if(!apply){record.state='review_passed_pending_admission';save(record);continue;}
  let contact=own[0]||existingContact;
  if(!contact){
   [contact]=await db('market_contacts',{},'POST',{id:randomUUID(),name:company,company,email:review.email,website:candidate.website,city,province:'ON',industry:review.reviewed_sector,category:review.reviewed_sector,stage:'target',owner_name:'John',owner_email:'business@starmovers.ca',preferred_channel:'email',sequence_paused:false,source_csv:sourceTag,notes:JSON.stringify({candidateId:review.organisation_id,source:record.publicationBasis,mailboxValidation:validation.validation,phoneCandidates:phones,scope:'Email introduction only; no automatic SMS enrollment'})});
  }
  if(contact&&!contacts.some(c=>c.id===contact.id))contacts.push(contact);
  if(!contact?.partner_company_id)throw Error('CRM account linkage missing');
  const peers=await db('market_contacts',{partner_company_id:'eq.'+contact.partner_company_id,limit:'1000'});
  if(peers.length===1000||peers.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||c.last_touch_at||c.last_inbound_at||['dnc','closed_lost'].includes(c.stage)))throw Error('Linked account history or suppression requires review');
  const ids=peers.map(c=>c.id);
  const [touches,tasks]=await Promise.all([db('market_touches',{contact_id:'in.('+ids.join(',')+')',limit:'1'}),db('crm_tasks',{status:'in.(open,in_progress)',related_id:'in.('+[contact.partner_company_id,...ids].join(',')+')',limit:'1'})]);
  if(touches.length||tasks.length)throw Error('Account touches/tasks require review');
  if(existingContact){
   const priorJobs=await db('sequence_jobs',{contact_id:'eq.'+contact.id,limit:'1'});
   if(priorJobs.length)throw Error('Existing contact queue history requires review');
   if(!contact.email){
    const [updated]=await db('market_contacts',{id:'eq.'+contact.id,email:'is.null'},'PATCH',{email:review.email});
    if(!updated)throw Error('Existing contact changed during admission');
    contact=updated;
   }
  }
  const at=new Date().toISOString(),until=new Date(Date.now()+23*3600000).toISOString();
  const facts={identity:review,mailbox:validation,outreach_eligibility:record.publicationBasis,shared_context:{checkedAt:at,peerIds:ids,touches,tasks,mailHistory,mailHistoryIndex:historyEvidence,suppressed},copy:{subject,text,phone,city,ownerApprovedDirection:true}};
  const records=Object.entries(facts).map(([kind,fact])=>({id:actionKey+':'+kind,kind,sha256:sha(fact),status:'approved',reviewedBy:'Codex recipient review under owner-authorized partnership campaign',holds:[],candidateId:review.organisation_id,contactId:contact.id,accountId:contact.partner_company_id,recipient:review.email,observedAt:at,validUntil:until,fact}));
  const payload={version:'ssm-prepared-email/1',candidateId:review.organisation_id,contactId:contact.id,accountId:contact.partner_company_id,actionKey,city,market,recipient:review.email,sender,replyTo,subject,text,reviewId:actionKey+':review',evidenceRefs:records.map(({id,kind,sha256})=>({id,kind,sha256}))};
  payload.contentHash=preparedEmailContentHash(payload);
  const approved={id:payload.reviewId,eventType:'prepared_email.reviewed',status:'approved',reviewedBy:'Codex recipient review',reviewedAt:at,expiresAt:until,holds:[],candidateId:payload.candidateId,contactId:payload.contactId,accountId:payload.accountId,actionKey,contentHash:payload.contentHash,evidenceRefs:payload.evidenceRefs};
  const gate=await validatePreparedEmail(payload,{loadReview:async()=>approved,loadEvidence:async id=>records.find(r=>r.id===id)});
  if(!gate.allowed)throw Error('Prepared payload validation: '+gate.reasons.join(', '));
  // Persist the exact payload before mutation. Re-entry recovers an existing
  // queue job above; an interrupted evidence-only admission needs reconciliation.
  record.state='admission_prepared';record.contactId=contact.id;record.accountId=contact.partner_company_id;record.payload=payload;save(record);
  const existingEvidence=await db('prepared_email_evidence',{id:'in.('+records.map(r=>r.id).join(',')+')',limit:'1'});
  if(existingEvidence.length)throw Error('Existing evidence without queued job requires reconciliation; no overwrite');
  await db('prepared_email_evidence',{},'POST',records.map(r=>({id:r.id,record:r})));
  if((await db('prepared_email_reviews',{id:'eq.'+approved.id})).length)throw Error('Existing review without queued job requires reconciliation');
  await db('prepared_email_reviews',{},'POST',{id:approved.id,record:approved});
  const event={event_key:'signal-review:'+actionKey,account_id:contact.partner_company_id,action_key:actionKey,event_type:'signal_introduction.reviewed',occurred_at:at,evidence:{contact_id:contact.id,channel:'email',recipient:contact.email,sender:payload.sender,content_hash:createHash('sha256').update(text).digest('hex'),reviewed_by:'Codex under explicit owner campaign authorization',source_url:review.sources[0].url,expires_at:until,reviewed_tasks:tasks}};
  if(!(await db('partnership_policy_events',{event_key:'eq.'+event.event_key})).length)await db('partnership_policy_events',{},'POST',event);
  const queued=await db('rpc/enqueue_prepared_email',{},'POST',{p_payload:payload,p_scheduled_at:new Date().toISOString(),p_batch_id:null});
  record.state='queued';record.contactId=contact.id;record.accountId=contact.partner_company_id;record.jobId=queued.id;record.payload=payload;report.queued++;
 }catch(error){record.state='held';record.reason=error.message;report.held++;if(/fresh mailbox index|required|fetch failed/.test(error.message)&&/mailbox index|fetch failed/.test(error.message)){save(record);throw error;}}
 save(record);
}
console.log(JSON.stringify({selected:report.selected,queued:report.queued,held:report.held,sent:0,outputPath}));
