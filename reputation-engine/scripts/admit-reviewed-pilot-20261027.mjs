import './gta-email-recovery-runtime.mjs';
import {db,base,headers} from './reply-runtime-20261015.mjs';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
import {preparedEmailContentHash,validatePreparedEmail} from '../lib/partnership-core/prepared-email.mjs';
const dir='artifacts/partnership-pilot-3000-20261027';
const read=name=>JSON.parse(fs.readFileSync(dir+'/'+name,'utf8'));
const lines=name=>fs.readFileSync(dir+'/'+name,'utf8').trim().split('\n').map(JSON.parse);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const host=x=>{try{return new URL(String(x).includes('://')?x:'https://'+x).hostname.replace(/^www\./,'').toLowerCase()}catch{return ''}};
// These source findings and conditional service paragraphs were reviewed individually.
const choices={
 'Revival Cleaning Services':['Brantford','437-465-0584'],
 'Brantford Property Management':['Brantford','437-465-0584'],
 'Fields Furniture & Fabrics':['Burlington','437-465-0584'],
 'Ideal Touch Janitorial Services':['Kitchener','226-241-9853'],
 'Rustix Studio':['St. Thomas','548-639-1428'],
 'Rapid Home Service':['Markham','437-465-0584'],
 'Elements carpet cleaning and restoration':['Windsor','226-887-0667'],
 'Auto Classic Trim':['Windsor','226-887-0667','Classic Auto Trim & Upholstery'],
 'Clean-Up!':['Kitchener','226-241-9853'],
 "Lester's Furniture Finishing":['Scarborough','437-465-0584'],
 'CR Cleaning Pros':['Kitchener','226-241-9853'],
};
const reviews=lines('practical-fit-source-review-20.jsonl').filter(r=>choices[r.organisation_name]);
const candidates=read('candidates.json');
const sources=lines('source-refresh.jsonl');
const technical=lines('role-inclusive-review.jsonl');
const mailbox=lines('ses-mailbox-validation.jsonl');
const apply=process.argv.includes('--admit');
const contacts=[];
for(let offset=0;;offset+=1000){
 if(offset>=100000)throw Error('CRM pagination limit; no admission');
 const rows=await db('market_contacts',{select:'*',order:'id',offset:String(offset),limit:'1000'});
 contacts.push(...rows);if(rows.length<1000)break;
}
const boxes=[await openZohoMailbox('saturn'),await openZohoMailbox('ottawa')];
const report={at:new Date().toISOString(),mode:apply?'admission':'review',selected:reviews.length,queued:0,held:0,sent:0,records:[]};
for(const review of reviews){
 const record={organisation:review.organisation_name,email:review.email};
 try{
  const candidate=candidates.find(c=>c.organisation_id===review.organisation_id);
  const source=sources.find(c=>c.organisation_id===review.organisation_id);
  const tech=technical.find(c=>c.organisation_id===review.organisation_id);
  const validation=mailbox.find(c=>c.email.toLowerCase()===review.email.toLowerCase());
  if(review.identity_email_binding!=='pass'||review.role_relevance!=='pass_for_conditional_context'||!source?.target_email_observed||source.restriction_signals.length||tech?.technical_screen_status!=='advance_to_identity_and_eligibility_review')throw Error('Source, identity, relevance or technical review hold');
  if(Date.now()-Date.parse(source.checked_at)>86400000||!validation||Date.now()-Date.parse(validation.checked_at)>86400000)throw Error('Review evidence stale');
  const phones=JSON.parse(candidate.phone_candidates||'[]').map(p=>p.replace(/\D/g,'').slice(-10));
  const matches=contacts.filter(c=>c.email?.toLowerCase()===review.email.toLowerCase()||host(c.website)===candidate.domain||norm(c.company)===norm(review.organisation_name)||(c.phone&&phones.includes(c.phone.replace(/\D/g,'').slice(-10))));
  const own=matches.filter(c=>c.source_csv==='pilot-3000-reviewed-20261027'&&c.email?.toLowerCase()===review.email.toLowerCase());
  if(matches.length&&(own.length!==1||matches.length!==1))throw Error('Existing CRM identity/history requires individual review');
  const [city,phone,correctedName]=choices[review.organisation_name];
  const company=correctedName||review.organisation_name;
  const subject='Working with '+company;
  const text=`Hi,\n\nI wanted to personally introduce myself to you and the team at ${company}. My name is John, and I run Saturn Star Movers, a local moving company serving ${city} and the surrounding areas.\n\n${review.proposed_contextual_paragraph.replaceAll('we would','we’d').replaceAll('We would','We’d')}\n\nWould it be okay if I sent over my digital card for you to keep on hand?\n\nYou can also reach me directly on ${phone}. I’m always happy to have a chat or arrange a meetup.\n\nJohn\nSaturn Star Movers\n\nP.S. If you’d prefer I didn’t follow up, just reply “no thanks” and I’ll happily honour that.`;
  const actionKey='pilot-3000-20261027:'+review.organisation_id;
  if(own[0]){
   const jobs=await db('sequence_jobs',{contact_id:'eq.'+own[0].id,template_key:'eq.prepared_email_v1',limit:'10'});
   if(jobs.some(j=>j.email_payload?.actionKey===actionKey)){record.state='already_admitted';record.jobIds=jobs.map(j=>j.id);report.records.push(record);continue;}
  }
  const mailHistory=[];
  for(const box of boxes)for(const term of ['sender:'+review.email,'to:'+review.email,'sender:'+candidate.domain,'to:'+candidate.domain]){
   const rows=await box.request(`/accounts/${box.accountId}/messages/search?${new URLSearchParams({searchKey:term,start:'1',limit:'200',includeto:'true'})}`);
   if(!Array.isArray(rows))throw Error('Unknown mailbox history result');
   if(rows.length)mailHistory.push({mailbox:box.mailbox,query:term,count:rows.length});
  }
  if(mailHistory.length)throw Error('Existing mailbox correspondence requires individual review: '+JSON.stringify(mailHistory));
  const suppressed=await db('crm_email_suppressions',{recipient:'eq.'+review.email.toLowerCase(),limit:'2'});
  if(suppressed.length)throw Error('Suppressed recipient');
  record.subject=subject;record.text=text;record.city=city;record.phone=phone;
  record.publicationBasis={assessment:'supported_for_this_business_relevant_message',basis:'recipient_business_conspicuous_publication',sourceUrls:review.sources.map(s=>s.url),identityAndRoleReason:review.finding,messageRelevance:review.proposed_contextual_paragraph,restrictionReview:'No prohibition found in the inspected source pages; bounded review, not a claim of complete website coverage.',sourceCheckedAt:source.checked_at,sourceHash:sha(source)};
  if(!apply){record.state='review_passed_pending_admission';report.records.push(record);continue;}
  let contact=own[0];
  if(!contact){
   [contact]=await db('market_contacts',{},'POST',{id:randomUUID(),name:company,company,email:review.email,website:candidate.website,city,province:'ON',industry:review.reviewed_sector,category:review.reviewed_sector,stage:'target',owner_name:'John',owner_email:'business@starmovers.ca',preferred_channel:'email',sequence_paused:false,source_csv:'pilot-3000-reviewed-20261027',notes:JSON.stringify({candidateId:review.organisation_id,source:record.publicationBasis,mailboxValidation:validation.validation,phoneCandidates:phones,scope:'Email introduction only; no automatic SMS enrollment'})});
  }
  if(!contact?.partner_company_id)throw Error('CRM account linkage missing');
  const peers=await db('market_contacts',{partner_company_id:'eq.'+contact.partner_company_id,limit:'1000'});
  if(peers.length===1000||peers.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||c.last_touch_at||c.last_inbound_at||['dnc','closed_lost'].includes(c.stage)))throw Error('Linked account history or suppression requires review');
  const ids=peers.map(c=>c.id);
  const touches=await db('market_touches',{contact_id:'in.('+ids.join(',')+')',limit:'1'});
  const tasks=await db('crm_tasks',{status:'in.(open,in_progress)',related_id:'in.('+[contact.partner_company_id,...ids].join(',')+')',limit:'1'});
  if(touches.length||tasks.length)throw Error('Account touches/tasks require review');
  const at=new Date().toISOString(),until=new Date(Date.now()+23*3600000).toISOString();
  const facts={identity:review,mailbox:validation,outreach_eligibility:record.publicationBasis,shared_context:{checkedAt:at,peerIds:ids,touches,tasks,mailHistory,suppressed},copy:{subject,text,phone,city,ownerApprovedDirection:true}};
  const records=Object.entries(facts).map(([kind,fact])=>({id:actionKey+':'+kind,kind,sha256:sha(fact),status:'approved',reviewedBy:'Codex recipient review under owner-authorized partnership campaign',holds:[],candidateId:review.organisation_id,contactId:contact.id,accountId:contact.partner_company_id,recipient:review.email,observedAt:at,validUntil:until,fact}));
  const payload={version:'ssm-prepared-email/1',candidateId:review.organisation_id,contactId:contact.id,accountId:contact.partner_company_id,actionKey,city,market:'saturn',recipient:review.email,sender:'John Owolabi <john@saturnstarmovers.ca>',replyTo:'business@starmovers.ca',subject,text,reviewId:actionKey+':review',evidenceRefs:records.map(({id,kind,sha256})=>({id,kind,sha256}))};
  payload.contentHash=preparedEmailContentHash(payload);
  const approved={id:payload.reviewId,eventType:'prepared_email.reviewed',status:'approved',reviewedBy:'Codex recipient review',reviewedAt:at,expiresAt:until,holds:[],candidateId:payload.candidateId,contactId:payload.contactId,accountId:payload.accountId,actionKey,contentHash:payload.contentHash,evidenceRefs:payload.evidenceRefs};
  const gate=await validatePreparedEmail(payload,{loadReview:async()=>approved,loadEvidence:async id=>records.find(r=>r.id===id)});
  if(!gate.allowed)throw Error('Prepared payload validation: '+gate.reasons.join(', '));
  for(const r of records)if(!(await db('prepared_email_evidence',{id:'eq.'+r.id})).length)await db('prepared_email_evidence',{},'POST',{id:r.id,record:r});
  if(!(await db('prepared_email_reviews',{id:'eq.'+approved.id})).length)await db('prepared_email_reviews',{},'POST',{id:approved.id,record:approved});
  const event={event_key:'signal-review:'+actionKey,account_id:contact.partner_company_id,action_key:actionKey,event_type:'signal_introduction.reviewed',occurred_at:at,evidence:{contact_id:contact.id,channel:'email',recipient:contact.email,sender:payload.sender,content_hash:createHash('sha256').update(text).digest('hex'),reviewed_by:'Codex under explicit owner campaign authorization',source_url:review.sources[0].url,expires_at:until,reviewed_tasks:tasks}};
  if(!(await db('partnership_policy_events',{event_key:'eq.'+event.event_key})).length)await db('partnership_policy_events',{},'POST',event);
  const queued=await db('rpc/enqueue_prepared_email',{},'POST',{p_payload:payload,p_scheduled_at:new Date().toISOString(),p_batch_id:null});
  record.state='queued';record.contactId=contact.id;record.accountId=contact.partner_company_id;record.jobId=queued.id;record.payload=payload;report.queued++;
 }catch(error){record.state='held';record.reason=error.message;report.held++;}
 report.records.push(record);
 fs.writeFileSync(dir+'/first-reviewed-admission.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({organisation:record.organisation,state:record.state,reason:record.reason,jobId:record.jobId}));
}
fs.writeFileSync(dir+'/first-reviewed-admission.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({selected:report.selected,queued:report.queued,held:report.held,sent:0}));
