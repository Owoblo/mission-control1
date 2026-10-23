import { isOutboundTwilioCall } from '../../lib/twilio-call-matching'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLostFeedbackDetail, shouldRequestMovedOnFeedback } from '../../lib/moved-on-feedback'
import { extractPartnershipReferralDetails } from '../../lib/server/partnership-referral-details'
import { attachArchivedRecordings, mergeCallLogs } from '../../lib/call-recording-links'
import { normalizeLead } from '../../lib/sales'
import { isProtectedApiRequest } from '../../lib/session-recovery'
import { assertOwnedLiveLeg } from '../../lib/server/dialer-access'
import { retryableAlertFailure } from '../../lib/server/alert-outbox'
test('outcome-only messages receive one feedback opportunity; volunteered reasons are retained',()=>{
 for(const message of ['I booked with another mover','We chose another company','We found another mover']){
  assert.equal(detectLostFeedbackDetail(message),false)
  assert.equal(shouldRequestMovedOnFeedback({message,booked:false,doNotContact:false,optedOut:false,alreadyAsked:false}),true)
  assert.equal(shouldRequestMovedOnFeedback({message,booked:true,doNotContact:false,optedOut:false,alreadyAsked:false}),false)
 }
 for(const reason of ['They were cheaper','because they had availability','your response was too slow','we are doing it ourselves'])assert.equal(detectLostFeedbackDetail(reason),true)
})
test('greeting addressees never replace explicit referred-customer names',()=>{
 assert.equal(extractPartnershipReferralDetails(['Hi John my grandson Robert needs movers next week. His name is Robert.']).customerName,'Robert')
 assert.equal(extractPartnershipReferralDetails(['Hi John, my grandson needs movers.']).customerName,undefined)
 assert.equal(extractPartnershipReferralDetails(['His name is Robert. Her name is Jane.']).customerName,undefined)
 assert.equal(extractPartnershipReferralDetails(['Hi John, my client Amanda needs movers.']).customerName,'Amanda')
})
test('all archived recordings remain linked even when one call has multiple audio files',()=>{
 const lead=normalizeLead({id:'l',name:'Fixture',stage:'new',createdAt:'2026-10-01',callLogs:[{id:'cl',type:'call',date:'2026-10-01',callSid:'CA1',notes:'Call'}]})
 const archives=[{recording_sid:'RE1',twilio_call_sid:'CA1',call_log_id:'cl',cloudflare_object_key:'recordings/one',created_at:'2026-10-01'}, {recording_sid:'RE2',twilio_call_sid:'CA1',call_log_id:'cl',cloudflare_object_key:'recordings/two',created_at:'2026-10-01'}]
 const recovered=attachArchivedRecordings(lead,archives)
 assert.equal(recovered.callLogs!.length,2)
 assert.deepEqual(new Set(recovered.callLogs!.map(log=>log.recordingSid)),new Set(['RE1','RE2']))
 assert.equal(attachArchivedRecordings(recovered,archives).callLogs!.length,2)
 assert.equal(mergeCallLogs(recovered.callLogs!,recovered.callLogs!).length,2)
})
test('session recovery observes same-origin protected APIs only',()=>{
 assert.equal(isProtectedApiRequest('/api/sales/leads','https://crm.test'),true)
 assert.equal(isProtectedApiRequest('https://api.stripe.com/v1/payment_intents','https://crm.test'),false)
 assert.equal(isProtectedApiRequest('/api/auth/login','https://crm.test'),false)
 assert.equal(isProtectedApiRequest('/api/marketing/contacts','https://crm.test'),true)
})
test('call control requires an in-progress leg belonging to the signed-in rep',()=>{
 const session={exp:Date.now()+1000,userId:'rep',role:'sales_rep' as const}
 assert.doesNotThrow(()=>assertOwnedLiveLeg([{sid:'CA1',from:'client:saturn-rep-rep',status:'in-progress'}],session))
 assert.throws(()=>assertOwnedLiveLeg([{sid:'CA1',from:'client:saturn-rep-other',status:'in-progress'}],session))
 assert.throws(()=>assertOwnedLiveLeg([{sid:'CA1',from:'client:saturn-rep-rep',status:'completed'}],session))
})
test('uncertain SES outcomes stay held; explicit rejections can retry',()=>{
 assert.equal(retryableAlertFailure({$metadata:{httpStatusCode:429}}),true)
 assert.equal(retryableAlertFailure({$metadata:{httpStatusCode:500}}),false)
 assert.equal(retryableAlertFailure(new Error('socket closed')),false)
})

test('Telnyx inbound SIP callbacks never get relabeled as outbound calls to our own branch',()=>{
 assert.equal(isOutboundTwilioCall('sip:+14165550123@sip.telnyx.com','sip:+14377823004@fixture.sip.twilio.com','inbound'),false)
 assert.equal(isOutboundTwilioCall('client:saturn-rep-fixture','sip:+14165550123@sip.telnyx.com','inbound'),true)
 assert.equal(isOutboundTwilioCall('+14377823004','+14165550123','outbound-dial'),true)
})
