import test from 'node:test';
import assert from 'node:assert/strict';
import {PREPARED_EMAIL_VERSION,preparedEmailContentHash,validatePreparedEmail} from '../../lib/partnership-core/prepared-email.mjs';
const now=Date.parse('2026-10-27T21:00:00Z');
function fixture(){
 const evidenceRefs=['identity','mailbox','outreach_eligibility','shared_context','copy'].map((kind,i)=>({id:'evidence-'+kind,kind,sha256:String(i+1).repeat(64)}));
 const payload={version:PREPARED_EMAIL_VERSION,candidateId:'candidate-1',contactId:'contact-1',accountId:'account-1',actionKey:'pilot-email-1',city:'Brampton',market:'saturn',recipient:'info@example.ca',sender:'John Owolabi <john@saturnstarmovers.ca>',replyTo:'business@starmovers.ca',subject:'Working with Example',text:'Hi,\nI run Saturn Star Movers. May I send my digital card?\nReply no thanks to stop.',reviewId:'review-1',evidenceRefs};
 payload.contentHash=preparedEmailContentHash(payload);
 const review={id:payload.reviewId,eventType:'prepared_email.reviewed',status:'approved',reviewedBy:'Reviewer',reviewedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),holds:[],candidateId:payload.candidateId,contactId:payload.contactId,accountId:payload.accountId,actionKey:payload.actionKey,contentHash:payload.contentHash,evidenceRefs:structuredClone(evidenceRefs)};
 const records=evidenceRefs.map(ref=>({...ref,status:'approved',reviewedBy:'Reviewer',holds:[],candidateId:payload.candidateId,contactId:payload.contactId,accountId:payload.accountId,recipient:payload.recipient,observedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+60000).toISOString()}));
 const options={now,loadReview:async id=>id===review.id?review:null,loadEvidence:async id=>records.find(r=>r.id===id)};
 return {payload,review,records,options};
}
test('valid stored exact-copy review clears only the contract, not live reservation',async()=>{
 const f=fixture(),r=await validatePreparedEmail(f.payload,f.options);
 assert.equal(r.allowed,true);assert.equal(r.requiresLiveReservation,true);assert.equal(r.scope,'prepared_contract_only');
});
test('missing loaders and request supplied approval flags cannot authorize',async()=>{
 const f=fixture();assert.equal((await validatePreparedEmail(f.payload)).allowed,false);
 assert.equal((await validatePreparedEmail({...f.payload,eligible:true,review:f.review},f.options)).allowed,false);
});
test('changing content or routing cannot reuse stored approval even with recomputed hash',async()=>{
 for(const key of ['recipient','sender','replyTo','subject','text','candidateId','contactId','accountId','actionKey','city']){
  const f=fixture();f.payload[key]+='changed';f.payload.contentHash=preparedEmailContentHash(f.payload);
  assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false,key);
 }
});
test('hash preserves exact whitespace and ordered evidence references',()=>{
 const f=fixture();assert.notEqual(preparedEmailContentHash({...f.payload,text:f.payload.text+' '}),f.payload.contentHash);
 assert.notEqual(preparedEmailContentHash({...f.payload,evidenceRefs:[...f.payload.evidenceRefs].reverse()}),f.payload.contentHash);
});
test('header injection and unresolved placeholders fail before any trusted reads',async()=>{
 for(const [key,value] of [['subject','Hi\r\nBcc: bad@example.ca'],['recipient','info@example.ca\n'],['sender','John\u0000'],['subject','Working with {business}'],['text','Saturn Star Movers in [verified service area]'],['text','Saturn Star Movers ${company}']]){
  const f=fixture();f.payload[key]=value;f.payload.contentHash=preparedEmailContentHash(f.payload);let called=false;f.options.loadReview=async()=>{called=true;return f.review;};
  assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false,key+value);assert.equal(called,false);
 }
});
test('review holds, absent holds, expiry and future review prevent release',async()=>{
 for(const change of [{holds:['dns_review']},{holds:undefined},{expiresAt:new Date(now).toISOString()},{reviewedAt:new Date(now+1).toISOString()},{expiresAt:new Date(now+86400000).toISOString()}]){
  const f=fixture();Object.assign(f.review,change);assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
 }
});
test('all required evidence kinds must exist and remain approved, bound and current',async()=>{
 for(const change of [{status:'pending'},{holds:['identity_conflict']},{recipient:'someone@example.ca'},{sha256:'0'.repeat(64)},{validUntil:new Date(now).toISOString()},{reviewedBy:''}]){
  const f=fixture();Object.assign(f.records[0],change);assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
 }
 const f=fixture();f.payload.evidenceRefs.pop();f.payload.contentHash=preparedEmailContentHash(f.payload);assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
});
test('Ottawa cannot inherit John sender or Saturn brand',async()=>{
 const f=fixture();f.payload.city='Ottawa';f.payload.market='ottawa';f.payload.contentHash=preparedEmailContentHash(f.payload);
 assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
 f.payload.sender='Dr. Courage | Dexa Movers <hello@dexamovers.ca>';f.payload.replyTo='hello@dexamovers.ca';f.payload.text='Hi, I run Dexa Movers. May I send a card?';f.payload.contentHash=preparedEmailContentHash(f.payload);f.review.contentHash=f.payload.contentHash;
 assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,true);
 f.payload.sender='Courage Eke <hello@dexamovers.ca>';f.payload.contentHash=preparedEmailContentHash(f.payload);
 assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
 f.review.contentHash=f.payload.contentHash;
 assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,true);
});
test('unsupported version and missing review fail closed',async()=>{
 const f=fixture();assert.equal((await validatePreparedEmail({...f.payload,version:'future'},f.options)).allowed,false);
 f.options.loadReview=async()=>null;assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
});
test('malformed JSON field types fail closed instead of throwing',async()=>{
 for(const value of [null,123,{},[]]){
  const f=fixture();f.payload.recipient=value;
  assert.equal((await validatePreparedEmail(f.payload,f.options)).allowed,false);
 }
});
test('database errors cannot produce a released contract',async()=>{
 const f=fixture();f.options.loadEvidence=async()=>{throw Error('offline');};
 assert.deepEqual((await validatePreparedEmail(f.payload,f.options)).reasons,['trusted_review_read_failed']);
});
