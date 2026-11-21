import {test} from 'node:test';import assert from 'node:assert/strict';
import {completedReviewBatch,supplyStatus} from '../../lib/partnership-core/review-supply.mjs';
test('only frozen complete unique review rows enter supply',()=>{
 const text=JSON.stringify({organisation_id:'a',email:'info@a.test'})+'\n';
 assert.throws(()=>completedReviewBatch(text,{complete:false,count:1}));
 assert.throws(()=>completedReviewBatch(text,{complete:true,count:2}));
 assert.throws(()=>completedReviewBatch(text+text,{complete:true,count:2}));
 assert.equal(completedReviewBatch(text,{complete:true,count:1}).rows.length,1);
});
test('prior attempted identities are not automatically retried from stale review files',()=>{
 const text=JSON.stringify({organisation_id:'a',email:'info@a.test'});
 assert.equal(completedReviewBatch(text,{complete:true,count:1},new Set(['a'])).rows.length,0);
});
test('watermark accounts for prepared supply and never claims research is running',()=>{
 assert.deepEqual(supplyStatus({pending:20,running:4,ready:30}),{queued:24,ready:30,lowWatermark:1000,reviewNeeded:946,state:'below_watermark'});
 assert.equal(supplyStatus({}).state,'needs_review_supply');
 assert.equal(supplyStatus({pending:1200}).reviewNeeded,0);
});
