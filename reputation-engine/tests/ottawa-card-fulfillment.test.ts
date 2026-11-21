import test from 'node:test'
import assert from 'node:assert/strict'
import {queueRequestedOttawaCard} from '../lib/server/partnership-card-fulfillment'
const sid='SM'+'1'.repeat(32)
test('clear acceptance queues one Dexa card; repeats and opt-outs do not create jobs',async()=>{
 const original=globalThis.fetch, env={...process.env};process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_KEY='test';
 const writes:Array<{table:string,body:any}>=[];let existing=false,optedOut=false;
 globalThis.fetch=(async(input:any,init:any={})=>{
  const url=new URL(String(input)),table=url.pathname.split('/').at(-1)!;
  let data:any=[];
  if(init.method==='POST'){const body=JSON.parse(init.body);writes.push({table,body});if(table==='sequence_jobs')existing=true;data=[body]}
  else if(table==='market_contacts')data=[{id:'contact',name:'Jane Smith',city:'Vanier',phone:'+16135550123',stage:'connected',do_not_contact:optedOut}];
  else if(table==='market_touches')data=[{id:'inbound',direction:'inbound',notes:'Inbound SMS: Yes please',created_at:new Date().toISOString(),metadata:{messageSid:sid,to:'+15482908695'}},{id:'offer',direction:'outbound',notes:'Would a digital card be useful?',created_at:new Date().toISOString()}];
  else if(table==='sequence_jobs')data=existing?[{id:'existing',status:'pending'}]:[];
  return new Response(JSON.stringify(data),{status:200})
 }) as typeof fetch;
 try{
  assert.equal((await queueRequestedOttawaCard('contact',sid)).queued,true);
  const touch=writes.find(w=>w.table==='market_touches')!.body;
  assert.match(touch.metadata.scheduled_reply.body,/613-519-3236/);
  assert.match(touch.metadata.scheduled_reply.mediaUrls[0],/2026-09-16-dexa\/ottawa\/card.jpg$/);
  assert.equal(touch.metadata.scheduled_reply.fromNumber,'+15482908695');
  assert.equal((await queueRequestedOttawaCard('contact',sid)).queued,false);
  optedOut=true;assert.equal((await queueRequestedOttawaCard('contact',sid)).queued,false);
  assert.equal(writes.filter(w=>w.table==='sequence_jobs').length,1);
 }finally{globalThis.fetch=original;for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env)}
})
