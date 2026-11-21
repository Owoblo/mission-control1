import test from 'node:test'
import assert from 'node:assert/strict'
import {persistPartnershipInboundPause} from '../../lib/server/partnership-inbound-pause'
const input={url:'https://example.invalid',headers:{},contactId:'contact-id',channel:'sms' as const}
test('pause requires a successful matching database receipt',async()=>{
 let body:any
 const r=await persistPartnershipInboundPause(input,async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({paused:true,contact_id:'contact-id',cancelled_pending:3})})
 assert.equal(body.p_channel,'sms');assert.equal(body.p_contact_id,'contact-id');assert.equal(r.cancelled_pending,3)
})
test('HTTP failure, invalid receipt and network failure propagate for webhook retry',async()=>{
 await assert.rejects(persistPartnershipInboundPause(input,async()=>new Response('',{status:503})),/must retry/)
 await assert.rejects(persistPartnershipInboundPause(input,async()=>Response.json({paused:true,contact_id:'wrong'})),/mismatch/)
 await assert.rejects(persistPartnershipInboundPause(input,async()=>{throw new Error('offline')}),/offline/)
})
