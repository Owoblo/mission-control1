import {createHash} from 'node:crypto';
import {isOttawa} from './ottawa.mjs';

export const PREPARED_EMAIL_VERSION='ssm-prepared-email/1';
const FIELDS=['version','candidateId','contactId','accountId','actionKey','city','market','recipient','sender','replyTo','subject','text','reviewId','evidenceRefs'];
const REQUIRED_EVIDENCE=['identity','mailbox','outreach_eligibility','shared_context','copy'];
const HEADER_CONTROL=/[\u0000-\u001f\u007f]/;
const PLACEHOLDER=/\{\{[\s\S]*?\}\}|\$\{[^}]*\}|\{\s*[a-z_][\w .-]*\s*\}|\[\s*(?:verified[_ ]*)?(?:first[_ ]?name|name|company|business|city|area|service[_ ]area|industry|sector|partnership[_ ]number|regional[_ ]partnership[_ ]number|phone|number)[^\]]*\]/i;
const SHA256=/^[a-f0-9]{64}$/;
const EMAIL=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const sameRefs=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validRefs(refs){
 return Array.isArray(refs)&&refs.length>=REQUIRED_EVIDENCE.length&&refs.length<=50&&
  refs.every(r=>r&&Object.keys(r).sort().join(',')==='id,kind,sha256'&&nonempty(r.id)&&REQUIRED_EVIDENCE.includes(r.kind)&&SHA256.test(r.sha256))&&
  new Set(refs.map(r=>r.id)).size===refs.length&&REQUIRED_EVIDENCE.every(k=>refs.some(r=>r.kind===k));
}

/** Hash exact reviewed values. No trimming, case conversion or content rendering. */
export function preparedEmailContentHash(payload){
 return createHash('sha256').update(JSON.stringify(FIELDS.map(k=>[k,payload?.[k]]))).digest('hex');
}

/**
 * Contract validation only: this does NOT reserve or send a message.
 * loadReview/loadEvidence MUST be server-owned reads of service-only persisted
 * records, never functions resolving request-body review/eligibility flags.
 * Execution must additionally recheck live context, suppression, sender health,
 * regional policy and reserve_partnership_action immediately before sending.
 * @param {Record<string, any>} payload
 * @param {{loadReview?: (id: string) => Promise<any>, loadEvidence?: (id: string) => Promise<any>, now?: number}} options
 */
export async function validatePreparedEmail(payload,{loadReview,loadEvidence,now=Date.now()}={}){
 const reasons=[];
 const result=()=>({allowed:reasons.length===0,reasons:[...new Set(reasons)],scope:'prepared_contract_only',requiresLiveReservation:true});
 if(!payload||typeof payload!=='object'||Array.isArray(payload)){reasons.push('invalid_payload');return result();}
 if(Object.keys(payload).some(k=>![...FIELDS,'contentHash'].includes(k)))reasons.push('unexpected_payload_fields');
 if(payload.version!==PREPARED_EMAIL_VERSION)reasons.push('unsupported_version');
 for(const k of FIELDS.filter(k=>k!=='evidenceRefs'))if(!nonempty(payload[k]))reasons.push('missing_'+k);
 for(const k of FIELDS.filter(k=>!['text','evidenceRefs'].includes(k)))if(typeof payload[k]==='string'&&HEADER_CONTROL.test(payload[k]))reasons.push('control_character_'+k);
 if(typeof payload.recipient!=='string'||!EMAIL.test(payload.recipient)||payload.recipient.includes('..')||payload.recipient!==payload.recipient.trim())reasons.push('invalid_recipient');
 if(!EMAIL.test(payload.replyTo||''))reasons.push('invalid_reply_to');
 if(typeof payload.subject==='string'&&(payload.subject.length>200||PLACEHOLDER.test(payload.subject)))reasons.push('invalid_or_unresolved_subject');
 if(typeof payload.text==='string'&&(payload.text.length>50000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text)||PLACEHOLDER.test(payload.text)))reasons.push('invalid_or_unresolved_text');
 if(!validRefs(payload.evidenceRefs))reasons.push('invalid_evidence_references');
 if(!SHA256.test(payload.contentHash||'')||payload.contentHash!==preparedEmailContentHash(payload))reasons.push('content_hash_mismatch');
 const ottawa=isOttawa(payload.city);
 if(payload.market!==(ottawa?'ottawa':'saturn'))reasons.push('regional_market_mismatch');
 if(ottawa){
  if(!['Courage Eke <hello@dexamovers.ca>','Dr. Courage | Dexa Movers <hello@dexamovers.ca>'].includes(payload.sender)||payload.replyTo!=='hello@dexamovers.ca')reasons.push('ottawa_sender_mismatch');
  if(!/Dexa Movers/i.test(payload.text||'')||/Saturn Star Movers/i.test(payload.text||''))reasons.push('ottawa_brand_mismatch');
 }else{
  if(!['John Owolabi <john@saturnstarmovers.ca>','John | Saturn Star Movers <john@saturnstarmovers.ca>'].includes(payload.sender)||payload.replyTo!=='business@starmovers.ca')reasons.push('saturn_sender_mismatch');
  if(!/Saturn Star Movers/i.test(payload.text||'')||/Dexa Movers/i.test(payload.text||''))reasons.push('saturn_brand_mismatch');
 }
 if(!Number.isFinite(now))reasons.push('invalid_clock');
 if(typeof loadReview!=='function'||typeof loadEvidence!=='function')reasons.push('trusted_review_loader_required');
 if(reasons.length)return result();
 let review,evidence;
 try{
  review=await loadReview(payload.reviewId);
  evidence=await Promise.all(payload.evidenceRefs.map(ref=>loadEvidence(ref.id)));
 }catch{reasons.push('trusted_review_read_failed');return result();}
 if(!review||review.id!==payload.reviewId||review.eventType!=='prepared_email.reviewed'||review.status!=='approved'||!nonempty(review.reviewedBy)){reasons.push('approved_persisted_review_required');return result();}
 const reviewedAt=Date.parse(review.reviewedAt),expiresAt=Date.parse(review.expiresAt);
 if(!Number.isFinite(reviewedAt)||!Number.isFinite(expiresAt)||reviewedAt>now||expiresAt<=now||expiresAt>reviewedAt+86400000)reasons.push('review_expired_or_invalid');
 if(!Array.isArray(review.holds)||review.holds.length)reasons.push('review_holds_or_unknown');
 for(const k of ['candidateId','contactId','accountId','actionKey','contentHash'])if(review[k]!==payload[k])reasons.push('review_binding_'+k);
 if(!sameRefs(review.evidenceRefs,payload.evidenceRefs))reasons.push('review_evidence_mismatch');
 for(let i=0;i<payload.evidenceRefs.length;i++){
  const ref=payload.evidenceRefs[i],record=evidence[i];
  if(!record||record.id!==ref.id||record.kind!==ref.kind||record.sha256!==ref.sha256||record.status!=='approved'||!nonempty(record.reviewedBy)){reasons.push('evidence_not_approved_'+ref.kind);continue;}
  if(!Array.isArray(record.holds)||record.holds.length)reasons.push('evidence_holds_'+ref.kind);
  if(record.candidateId!==payload.candidateId||record.contactId!==payload.contactId||record.accountId!==payload.accountId||record.recipient!==payload.recipient)reasons.push('evidence_binding_'+ref.kind);
  const observedAt=Date.parse(record.observedAt),validUntil=Date.parse(record.validUntil);
  if(!Number.isFinite(observedAt)||!Number.isFinite(validUntil)||observedAt>now||validUntil<=now)reasons.push('evidence_expired_'+ref.kind);
 }
 return result();
}
