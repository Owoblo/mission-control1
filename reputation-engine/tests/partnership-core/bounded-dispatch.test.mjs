import test from 'node:test';import assert from 'node:assert/strict';
import {runBoundedDispatch,serialGate} from '../../lib/partnership-core/bounded-dispatch.mjs';
const wait=()=>new Promise(r=>setTimeout(r,5));
test('parallel preparation is bounded; provider gate never overlaps',async()=>{
 let active=0,peak=0,sending=0,maxSending=0;const gate=serialGate();
 const r=await runBoundedDispatch([1,2,3,4,5,6],4,async n=>{active++;peak=Math.max(peak,active);await wait();await gate(async()=>{sending++;maxSending=Math.max(maxSending,sending);await wait();sending--;});active--;return n;});
 assert.equal(peak,4);assert.equal(maxSending,1);assert.equal(r.results.length,6);assert.equal(r.stopped,false);
});
test('failure stops new claims while allowing in-flight jobs to finish',async()=>{
 const r=await runBoundedDispatch([1,2,3,4],2,async n=>{if(n===1)throw Error('hold');await wait();return n;});
 assert.equal(r.stopped,true);assert.equal(r.unstarted,2);assert.equal(r.results.filter(x=>x.ok).length,1);
});
