import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sesFailureClass} from '../../lib/partnership-core/ses-failure-classification.mjs';
test('validation suppression is separated without changing safety event',()=>{
 const event={event_type:'email_bounced',payload:{Message:JSON.stringify({bounce:{bounceSubType:'EmailValidationSuppressed'}})}};
 assert.equal(sesFailureClass(event),'validation_blocked');assert.equal(event.event_type,'email_bounced');
});
test('ordinary bounce, suppressed and malformed evidence remain distinct',()=>{
 assert.equal(sesFailureClass({event_type:'email_bounced',payload:{bounce:{bounceSubType:'NoEmail'}}}),'delivery_bounced');
 assert.equal(sesFailureClass({event_type:'email_bounced',payload:{bounce:{bounceSubType:'OnAccountSuppressionList'}}}),'suppression_blocked');
 assert.equal(sesFailureClass({event_type:'email_bounced',payload:'bad'}),'bounce_unclassified');
 assert.equal(sesFailureClass({event_type:'email_delivered'}),'email_delivered');
});
