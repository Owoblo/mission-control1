import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeEmailDelivery,smsFailureAction } from '../../lib/partnership-delivery-metrics'
test('late bounce supersedes delivery and repeated events do not inflate denominators',()=>{
 const result=summarizeEmailDelivery(['email_provider_accepted','email_provider_accepted','email_delivered','email_bounced'].map(event_type=>({event_type,provider_message_id:'one',payload:{mail:{source:'sender@example.test'},bounce:{bounceType:'Permanent'}}})))
 assert.equal(result.accepted,1);assert.equal(result.delivered,0);assert.equal(result.hardBounced,1);assert.equal(result.hardBounceRate,1)
})
test('simulator messages do not pollute reputation and challenges stay separate from hard bounces',()=>{
 const result=summarizeEmailDelivery([{event_type:'email_provider_accepted',provider_message_id:'a'},{event_type:'email_bounced',provider_message_id:'a',payload:{bounce:{bounceType:'Transient'}}},{event_type:'email_bounced',provider_message_id:'sim',payload:{mail:{destination:['bounce@simulator.amazonses.com']},bounce:{bounceType:'Permanent'}}}])
 assert.equal(result.accepted,1);assert.equal(result.bounced,1);assert.equal(result.hardBounced,0)
 assert.match(smsFailureAction(30006),/line type/);assert.match(smsFailureAction(30007),/filtering/);assert.match(smsFailureAction(21610),/opted out/)
})
