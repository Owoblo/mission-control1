import {test} from 'node:test';import assert from 'node:assert/strict';
import {pilotDeliveryCapacity} from '../../lib/partnership-core/pilot-delivery-capacity.mjs';
test('bounced delivery is replaced but pending and ambiguous sends reserve slots',()=>{
 const dispatches=[{recipient:'a@x.test',state:'accepted',message_id:'a'},{recipient:'b@x.test',state:'accepted',message_id:'b'},{recipient:'c@x.test',state:'ambiguous'}];
 const events=[{provider_message_id:'a',event_type:'email_delivered'},{provider_message_id:'a',event_type:'email_bounced'}];
 assert.deepEqual(pilotDeliveryCapacity({target:3,dispatches,events}),{target:3,distinctDelivered:0,committedRecipients:2,availableInitialSlots:1});
});
test('duplicate receipts and addresses never inflate unique delivered totals',()=>{
 const dispatches=[{recipient:'A@x.test',state:'accepted',message_id:'a'},{recipient:'a@x.test',state:'accepted',message_id:'b'}];
 const events=['a','b','a'].map(id=>({provider_message_id:id,event_type:'email_delivered'}));
 assert.equal(pilotDeliveryCapacity({target:3,dispatches,events}).distinctDelivered,1);
});
test('unknown recipient fails and full target has no additional sending slots',()=>{
 assert.throws(()=>pilotDeliveryCapacity({dispatches:[{state:'held'}]}));
 assert.equal(pilotDeliveryCapacity({target:1,dispatches:[{recipient:'a@x.test',state:'accepted',message_id:'a'}]}).availableInitialSlots,0);
});
