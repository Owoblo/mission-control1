import test from 'node:test'
import assert from 'node:assert/strict'
import { persistScheduledReplyReceipt } from '../../lib/server/partnership-scheduled-receipt'
const input = {url:'https://example.test',headers:{},jobId:'job',contactId:'contact',touchId:'touch',fromNumber:'+15195550111',toNumber:'+15195550112',body:'Requested card',mediaUrls:['https://example.test/card.png'],now:'2026-09-16T13:00:00Z',provider:{sid:'SM'+'1'.repeat(32),status:'queued'},existingMetadata:{scheduled_reply:{body:'Requested card'}}}
test('receipt survives before completion and preserves follow-up promises', async () => {
 const calls: Array<{url:string;body:any}>=[]
 const mock = (async (url:unknown, options:RequestInit) => {calls.push({url:String(url),body:JSON.parse(String(options.body))});return Response.json([{}])}) as typeof fetch
 await persistScheduledReplyReceipt(input,mock)
 assert.equal(calls[0].body.metadata.twilioSid,input.provider.sid)
 assert.equal(calls[0].body.metadata.scheduled_reply.body,'Requested card')
 assert.equal(calls[1].body.metadata.delivery_state,'accepted')
 assert.equal(calls[2].body.next_follow_up,undefined)
 assert.equal(calls[3].body.status,'sent')
})
test('failed receipt write does not mark job sent', async () => {
 let count=0
 const mock=(async ()=>{count++;return new Response('failed',{status:500})}) as typeof fetch
 await assert.rejects(persistScheduledReplyReceipt(input,mock),/do not resend/)
 assert.equal(count,1)
})
test('missing provider SID never produces a success record', async () => {
 let count=0
 const mock=(async ()=>{count++;return Response.json([{}])}) as typeof fetch
 await assert.rejects(persistScheduledReplyReceipt({...input,provider:{}},mock),/missing message SID/)
 assert.equal(count,0)
})
test('missing scheduled touch blocks later completion', async () => {
 const mock=(async ()=>Response.json([])) as typeof fetch
 await assert.rejects(persistScheduledReplyReceipt(input,mock),/target missing/)
})

test('MMS receipts retain MM-prefixed provider IDs', async () => {
 const calls:any[]=[]
 const mock=(async (_url:unknown,options:RequestInit)=>{calls.push(JSON.parse(String(options.body)));return Response.json([{}])}) as typeof fetch
 await persistScheduledReplyReceipt({...input,provider:{sid:'MM'+'2'.repeat(32),status:'queued'}},mock)
 assert.equal(calls[0].metadata.twilioSid,'MM'+'2'.repeat(32))
})
