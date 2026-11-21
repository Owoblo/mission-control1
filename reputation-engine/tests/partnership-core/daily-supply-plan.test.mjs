import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailySupplyPlan} from '../../lib/partnership-core/daily-supply-plan.mjs';
test('followups consume total budget instead of adding to 4000',()=>{
 const p=dailySupplyPlan({dueFollowups:1500,readyInitials:1000,readyFollowups:200});
 assert.equal(p.initialSlots,2500);assert.equal(p.followupSlots,1500);
 assert.equal(p.initialsToPrepare,1500);assert.equal(p.followupsToPrepare,1300);
 assert.equal(p.preparedReserveTarget,7000);assert.equal(p.preparedReserveShortfall,5800);
});
test('followup backlog cannot produce negative initial quota',()=>{
 const p=dailySupplyPlan({dueFollowups:5000});assert.equal(p.initialSlots,0);assert.equal(p.followupSlots,4000);
});
test('invalid counts fail instead of inflating capacity',()=>{
 assert.throws(()=>dailySupplyPlan({dueFollowups:-1}));assert.throws(()=>dailySupplyPlan({readyInitials:NaN}));
});
