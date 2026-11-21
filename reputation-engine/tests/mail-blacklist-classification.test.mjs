import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyBlacklistScan} from '../scripts/mail-blacklist-classification.mjs';
const now=Date.now();
const scan=(rows)=>({created_at:new Date(now).toISOString(),detections:rows.filter(r=>r.detected).length,blacklists:rows});
test('fresh-domain listings are age warnings, not abuse detections',()=>{
 const result=classifyBlacklistScan(scan([{id:'sem_fresh',detected:true},{id:'spamhaus_dbl',detected:false}]),now);
 assert.equal(result.status,'new_domain');assert.equal(result.otherListings.length,0);
});
test('age entries do not hide other detections',()=>{
 assert.equal(classifyBlacklistScan(scan([{id:'sem_fresh',detected:true},{id:'spamhaus_dbl',detected:true}]),now).status,'listed');
});
test('missing, stale and inconsistent results stay unknown',()=>{
 assert.equal(classifyBlacklistScan(null,now).status,'unknown');
 assert.equal(classifyBlacklistScan({...scan([]),created_at:new Date(now-49*3600000).toISOString()},now).status,'unknown');
 assert.equal(classifyBlacklistScan({...scan([]),detections:4},now).status,'unknown');
});
