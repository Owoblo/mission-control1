import test from 'node:test';import assert from 'node:assert/strict';import {scanTable} from './conversation_scan.mjs';
const source=Array.from({length:2505},(_,i)=>({id:String(i).padStart(5,'0')}));
function fake(rows=source){return async(q,count)=>({count:count?rows.length:null,rows:rows.filter(x=>!q.id||x.id>q.id.slice(3)).slice(0,Number(q.limit))})}
test('scans over two thousand records without truncation',async()=>{const r=await scanTable({table:'touches',cutoff:'2026-11-18T12:00:00Z',fetchPage:fake()});assert.equal(r.rows.length,2505);assert.equal(r.receipt.pages,3);assert.equal(r.receipt.state,'complete')});
test('concurrent count changes remain incomplete',async()=>{let counts=0,last;await assert.rejects(scanTable({table:'touches',fetchPage:async(q,c)=>c?{rows:[],count:++counts===1?2505:2506}:fake()(q,c),onReceipt:r=>last=r}));assert.equal(last.state,'incomplete')});
test('partial request failure cannot mark scan complete',async()=>{let n=0,last;await assert.rejects(scanTable({table:'touches',fetchPage:async(q,c)=>{if(!c&&++n===2)throw Error('network');return fake()(q,c)},onReceipt:r=>last=r}));assert.equal(last.rows,1000);assert.equal(last.state,'incomplete')});
test('bounded pages fail visibly',async()=>{await assert.rejects(scanTable({table:'touches',fetchPage:fake(),maxPages:1}),/Page limit/) });

test('provider events paginate with their actual event_id key',async()=>{const rows=Array.from({length:1001},(_,i)=>({event_id:String(i).padStart(5,'0')}));const r=await scanTable({table:'provider',idColumn:'event_id',fetchPage:async(q,count)=>({count:count?rows.length:null,rows:rows.filter(x=>!q.event_id||x.event_id>q.event_id.slice(3)).slice(0,Number(q.limit))})});assert.equal(r.receipt.rows,1001);assert.equal(r.receipt.state,'complete')});
