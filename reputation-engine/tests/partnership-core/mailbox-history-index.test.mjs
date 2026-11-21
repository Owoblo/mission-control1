import test from 'node:test';import assert from 'node:assert/strict';
import {indexedMailboxHistory as match} from '../../lib/partnership-core/mailbox-history-index.mjs';
const now=Date.now();const base=()=>({complete:true,startedAt:new Date(now-1000).toISOString(),completedAt:new Date(now).toISOString(),markets:[{market:'saturn',mailbox:'a',messages:[{messageId:'1',addresses:['colleague@example.ca']}]},{market:'ottawa',mailbox:'b',messages:[]}]});
test('company-domain correspondence prevents false clean history',()=>assert.equal(match(base(),'info@example.ca','example.ca',now).length,1));
test('domain matching is exact',()=>assert.equal(match(base(),'info@otherexample.ca','otherexample.ca',now).length,0));
test('incomplete or stale histories cannot clear admission',()=>{assert.throws(()=>match({...base(),complete:false},'a@b.ca','b.ca',now));assert.throws(()=>match(base(),'a@b.ca','b.ca',now+16*60000));});
