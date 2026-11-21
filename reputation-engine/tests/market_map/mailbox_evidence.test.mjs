import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileMailboxReceipts} from '../../scripts/market_map/mailbox_evidence.mjs';
const now=Date.parse('2026-11-05T18:30:00Z');
const row={email:'info@example.ca',holds:['mailbox_confidence_review','person_or_business_route_identity_review','category_message_approval_required','existing_relationship_review']};
const receipt={email:row.email,checked_at:'2026-11-05T07:00:00Z',state:'mailbox_review_required',request_id:'provider-id',validation:{IsValid:{ConfidenceVerdict:'HIGH'},Evaluations:Object.fromEntries(Object.entries({HasValidSyntax:'HIGH',HasValidDnsRecords:'HIGH',MailboxExists:'MEDIUM',IsDisposable:'LOW',IsRandomInput:'LOW'}).map(([k,v])=>[k,{ConfidenceVerdict:v}]))}};
test('reuse passing receipt without removing identity relationship or approval holds',()=>{const r=reconcileMailboxReceipts([row],{[row.email]:receipt},now)[0];assert.equal(r.mailbox_policy_pass,true);assert.ok(!r.holds.includes('mailbox_confidence_review'));assert.ok(r.holds.includes('existing_relationship_review'));assert.ok(r.holds.includes('category_message_approval_required'));assert.equal(r.send_ready,false);assert.equal(receipt.state,'mailbox_review_required');});
test('expired future mismatched and incomplete receipts never pass',()=>{
 for(const change of [{checked_at:'2026-11-01T07:00:00Z'},{checked_at:'2026-11-06T07:00:00Z'},{email:'someone@else.ca'},{state:'request_reserved_no_blind_retry'},{request_id:null}])assert.equal(reconcileMailboxReceipts([row],{[row.email]:{...receipt,...change}},now)[0].mailbox_policy_pass,false);
});
test('missing and low-confidence results are held without provider calls',()=>{
 assert.equal(reconcileMailboxReceipts([row],{},now)[0].mailbox_evidence.state,'no_saved_receipt');
 const low=structuredClone(receipt);low.validation.Evaluations.MailboxExists.ConfidenceVerdict='LOW';assert.equal(reconcileMailboxReceipts([row],{[row.email]:low},now)[0].mailbox_evidence.state,'confidence_review_required');
});
