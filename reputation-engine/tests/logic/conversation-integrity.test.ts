import test from 'node:test'
import assert from 'node:assert/strict'
import { callbackHold, extractConversationSignal, isVoicemailTranscript, salesQualificationBlocked, smsDeliveryLabel, torontoTime } from '../../lib/conversation-integrity'
import type { CRMLead } from '../../lib/types'

test('customer date uncertainty and Monday reply are separate from the move date', () => {
  const signal = extractConversationSignal("Hi. I will get back to you when I'm sure what day works! I will contact you Monday to advise what day. Thx", '2026-10-22T23:07:00Z')
  assert.equal(signal.kind, 'date_unconfirmed')
  assert.deepEqual(signal.callback, { requestedDay:'2026-10-26', notBefore:'2026-10-26T21:00:00.000Z', dueAt:'2026-10-26T21:00:00.000Z', customerWillReply:true })
  assert.equal(extractConversationSignal('Soon. Once unit is ready. Thx','2026-10-23T13:33:00Z').kind,'date_unconfirmed')
})
test('a requested callback uses the customer day across Toronto midnight and DST', () => {
  const signal = extractConversationSignal("Can you phone me tomorrow instead? I'm in a meeting.",'2026-10-22T00:58:26Z','call')
  assert.equal(signal.callback?.requestedDay,'2026-10-22')
  assert.equal(signal.callback?.customerWillReply,false)
  assert.equal(torontoTime('2026-10-31',8),'2026-10-31T12:00:00.000Z')
  assert.equal(torontoTime('2026-11-01',8),'2026-11-01T13:00:00.000Z')
  assert.equal(torontoTime('2027-03-14',8),'2027-03-14T12:00:00.000Z')
})
test('explicit decline and no active move require review without treating a general question as rejection', () => {
  assert.equal(extractConversationSignal('I found a friend to help me move. Thanks.','2026-10-22T20:09Z','call').kind,'declined')
  assert.equal(extractConversationSignal("There's no current move date",'2026-10-24T12:00Z').kind,'no_active_move')
  assert.equal(extractConversationSignal('Can you tell me what your moving rate is?','2026-10-24T12:00Z').kind,undefined)
})
test('short human conversations and call back wording are not voicemail', () => {
  assert.equal(isVoicemailTranscript('Hello this is Ava. Thank you for your quote. I will call back after I check with my friend.'),false)
  assert.equal(isVoicemailTranscript('Hi John, yes that works. Thank you.'),false)
  assert.equal(isVoicemailTranscript('You have reached the mailbox. Please leave a message after the tone.'),true)
  assert.equal(isVoicemailTranscript('Hello, looking for a driver.','RecordVerb'),true)
})
test('phone screening followed by the customer answering remains a human conversation', () => {
  assert.equal(isVoicemailTranscript('Please record your name and reason for calling. Please stay on the line. Hello, Tina speaking. Can you phone me tomorrow instead?'),false)
  assert.equal(isVoicemailTranscript('Please record your name and reason for calling. Please stay on the line.'),true)
})
test('callback hold expires but unresolved commitments still block qualification', () => {
  const lead={callbackCommitment:{status:'open',notBefore:'2026-10-26T12:00Z'}} as CRMLead
  assert.ok(callbackHold(lead,new Date('2026-10-25T12:00Z')))
  assert.equal(callbackHold(lead,new Date('2026-10-26T13:00Z')),null)
  assert.ok(salesQualificationBlocked(lead))
  assert.ok(salesQualificationBlocked({conversationReview:{status:'open'}} as CRMLead))
  assert.ok(salesQualificationBlocked({deliveryFailureReview:{status:'open'}} as CRMLead))
})
test('message submission and carrier delivery have different labels', () => {
  assert.equal(smsDeliveryLabel('delivered'),'Delivered')
  assert.match(smsDeliveryLabel('sent'),/awaiting delivery/)
  assert.match(smsDeliveryLabel(null),/unconfirmed/)
  assert.match(smsDeliveryLabel('delivery_failed'),/Not delivered/)
})
