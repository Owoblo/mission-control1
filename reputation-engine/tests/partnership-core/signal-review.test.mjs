import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validSignalReview} from '../../lib/partnership-core/signal-review.mjs';
import {ottawaActionAllowed} from '../../lib/partnership-core/ottawa.mjs';
const now=Date.parse('2026-09-19T12:00:00Z');
const action={key:'signal-test',accountId:'account',contactId:'contact',channel:'email',recipient:'info@example.ca',sender:'Dr. Courage | Dexa Movers <hello@dexamovers.ca>',content:'Reviewed message'};
const event={event_type:'signal_introduction.reviewed',action_key:action.key,account_id:action.accountId,occurred_at:new Date(now-1000).toISOString(),evidence:{contact_id:action.contactId,channel:'email',recipient:action.recipient,sender:action.sender,content_hash:createHash('sha256').update(action.content).digest('hex'),reviewed_by:'John',source_url:'https://example.ca/news',expires_at:new Date(now+60000).toISOString(),reviewed_tasks:[]}};
test('review binds identity, recipient, sender, content, and action',()=>{
 assert.equal(validSignalReview(event,action,now),true);
 for(const field of ['key','accountId','contactId','channel','recipient','sender','content'])
  assert.equal(validSignalReview(event,{...action,[field]:'changed'},now),false,field);
 assert.equal(validSignalReview(null,action,now),false);
});
test('reviews expire and cannot be future dated or indefinitely valid',()=>{
 assert.equal(validSignalReview(event,action,now+60000),false);
 assert.equal(validSignalReview({...event,occurred_at:new Date(now+1).toISOString()},action,now),false);
 assert.equal(validSignalReview({...event,evidence:{...event.evidence,expires_at:new Date(now+86400000).toISOString()}},action,now),false);
});
test('only reviewed Dexa email introductions activate Ottawa',()=>{
 const a={city:'Ottawa',kind:'cold_introduction',channel:'email',sender:action.sender};
 assert.equal(ottawaActionAllowed(a),false);
 assert.equal(ottawaActionAllowed({...a,reviewedSignal:true}),true);
 assert.equal(ottawaActionAllowed({...a,reviewedSignal:true,sender:'john@saturnstarmovers.ca'}),false);
 assert.equal(ottawaActionAllowed({...a,reviewedSignal:true,channel:'sms'}),false);
 assert.equal(ottawaActionAllowed({...a,reviewedSignal:true,channel:'direct_mail'}),false);
});
