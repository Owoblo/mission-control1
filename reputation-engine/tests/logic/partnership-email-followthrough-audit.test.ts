import test from 'node:test'
import assert from 'node:assert/strict'
import { auditEmailContact, humanEmailTouch } from '../../lib/partnership-email-followthrough-audit'
const contact={id:'c',company:'Example'}
const inbound={id:'in',channel:'email',direction:'inbound',created_at:'2026-10-27T10:00:00Z',metadata:{body:'Please send your card.',human_reply:true}}
const outbound={id:'out',channel:'email',direction:'outbound',created_at:'2026-10-27T11:00:00Z',metadata:{provider_message_id:'ses1',delivery_state:'accepted'}}
test('delivery/open events never become human replies',()=>{
 for(const outcome_code of ['email_opened','delivered','email_delivery_failure'])assert.equal(humanEmailTouch({...inbound,outcome_code}),false)
 assert.equal(humanEmailTouch({...inbound,metadata:{body:'Automatic reply: away from office'}}),false)
 assert.equal(humanEmailTouch({...inbound,notes:'SES bounced event',metadata:{}}),false)
})
test('an accepted outbound can flag stale review tasks but cannot prove fulfilment',()=>{
 const row=auditEmailContact(contact,[inbound,outbound],[{id:'task',title:'Review email reply',status:'open',created_at:'2026-10-27T10:05:00Z'}])!
 assert.equal(row.unansweredHumanReplyCandidate,false)
 assert.equal(row.pendingFulfilmentReview,true)
 assert.equal(row.explicitFulfilmentReceipt,null)
 assert.deepEqual(row.answeredWithPotentiallyStaleOpenReviewTasks,['task'])
})
test('reserved send is not an answer and opt-outs are not unanswered outreach candidates',()=>{
 const row=auditEmailContact(contact,[inbound,{...outbound,metadata:{...outbound.metadata,delivery_state:'reserved'}}],[])!
 assert.equal(row.unansweredHumanReplyCandidate,true)
 assert.equal(row.subsequentOutboundWithoutEstablishedReceipt.length,1)
 assert.equal(auditEmailContact(contact,[{...inbound,metadata:{body:'No thanks'}}],[])!.unansweredHumanReplyCandidate,false)
})
test('explicit receipt must bind the current request to a matching subsequent provider receipt',()=>{
 const review={reply_required:false,fulfilled_by_touch_id:'out',provider_receipt:'ses1',reviewed_at:'2026-10-27T11:01:00Z',note:'Requested card reviewed and sent.'}
 const row=auditEmailContact(contact,[{...inbound,metadata:{...inbound.metadata,partnership_review:review}},outbound],[])!
 assert.ok(row.explicitFulfilmentReceipt)
 assert.equal(row.pendingFulfilmentReview,false)
 assert.equal(auditEmailContact(contact,[{...inbound,metadata:{...inbound.metadata,partnership_review:{...review,provider_receipt:'wrong'}}},outbound],[])!.pendingFulfilmentReview,true)
})
