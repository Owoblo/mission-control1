import assert from 'node:assert/strict'
import {test} from 'node:test'
import {withProviderWebhookReceipt} from '../../lib/server/provider-webhook-receipts'
import {createReservedCheckout} from '../../lib/server/checkout-operation'
async function sandbox(fn:()=>Promise<void>){const f=global.fetch;const previous=[process.env.SUPABASE_URL,process.env.SUPABASE_KEY];process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_KEY='test';try{await fn()}finally{global.fetch=f;for(const [i,k] of ['SUPABASE_URL','SUPABASE_KEY'].entries()){if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i]}}}
const identity={account:'saturn',live:false,id:'evt_test',type:'checkout.session.completed',objectId:'cs_test'}
test('Webhook completion duplicates skip processing; active receipt asks provider to retry',()=>sandbox(async()=>{
 let calls=0;global.fetch=async()=>Response.json({claimed:false,complete:true})
 assert.equal((await withProviderWebhookReceipt(identity,async()=>{calls++;return Response.json({ok:true})})).status,200)
 assert.equal(calls,0)
 global.fetch=async()=>Response.json({claimed:false,complete:false})
 assert.equal((await withProviderWebhookReceipt(identity,async()=>{calls++;return Response.json({ok:true})})).status,503)
 assert.equal(calls,0)
}))
test('Webhook cannot acknowledge success before receipt storage and completion commit',()=>sandbox(async()=>{
 let calls=0;global.fetch=async()=>new Response(null,{status:500})
 assert.equal((await withProviderWebhookReceipt(identity,async()=>{calls++;return Response.json({ok:true})})).status,503)
 assert.equal(calls,0)
 global.fetch=async(url)=>String(url).includes('/rpc/')?Response.json({claimed:true,lease:'lease'}):new Response(null,{status:500})
 assert.equal((await withProviderWebhookReceipt(identity,async()=>Response.json({ok:true}))).status,503)
}))
test('Failed webhook processing persists retry state under its lease',()=>sandbox(async()=>{
 let state=''
 global.fetch=async(url,init)=>{if(String(url).includes('/rpc/'))return Response.json({claimed:true,lease:'lease'});state=JSON.parse(String(init?.body)).state;return Response.json([{id:'receipt'}])}
 assert.equal((await withProviderWebhookReceipt(identity,async()=>{throw new Error('DB outage')})).status,500)
 assert.equal(state,'retry')
}))
const input=()=>({quoteId:'q',leadId:'l',revision:0,account:'saturn',stripeKey:'sk_test_fixture_not_real',deposit:250,protectionChoice:'declined',params:new URLSearchParams({mode:'payment',customer:'cus_test'})})
test('Checkout retries use persisted parameters and the same provider key',()=>sandbox(async()=>{
 const op={id:'op',state:'reserved',request_params:'mode=payment&customer=cus_original',created_at:new Date().toISOString()}
 let providerCalls=0
 global.fetch=async(url,init)=>{
  if(String(url).includes('/rpc/'))return Response.json(op)
  if(String(url).includes('api.stripe.com')){providerCalls++;assert.equal((init?.headers as any)['Idempotency-Key'],'ssm-checkout-op');assert.equal(new URLSearchParams(String(init?.body)).get('customer'),'cus_original');return Response.json({id:'cs_test',url:'https://checkout.stripe.test/session',livemode:false})}
  return Response.json([op])
 }
 await createReservedCheckout(input());await createReservedCheckout(input());assert.equal(providerCalls,2)
 // Two retries may reach Stripe, but share one persisted request/key (provider idempotency).
}))
test('An old uncertain checkout is never recreated after provider key retention',()=>sandbox(async()=>{
 let providerCalls=0
 global.fetch=async url=>{if(String(url).includes('api.stripe.com'))providerCalls++;return Response.json({id:'op',state:'reserved',request_params:'mode=payment',created_at:'2020-01-01T00:00:00Z'})}
 await assert.rejects(createReservedCheckout(input()),/unresolved/);assert.equal(providerCalls,0)
}))
test('Open checkout reuses provider session and expired checkout must be closed first',()=>sandbox(async()=>{
 let creates=0;let expired=false;let closed=false
 global.fetch=async(url,init)=>{
  const path=String(url)
  if(path.includes('/rpc/'))return Response.json({id:'op',session_id:'cs_test',state:'open'})
  if(path.includes('api.stripe.com')){if(init?.method==='POST')creates++;return Response.json({id:'cs_test',livemode:false,status:expired?'expired':'open',url:'https://checkout.stripe.test/session',metadata:{ssmCheckoutOperationId:'op'}})}
  closed=JSON.parse(String(init?.body)).state==='expired';return Response.json([{id:'op'}])
 }
 assert.equal((await createReservedCheckout(input())).id,'cs_test');assert.equal(creates,0)
 expired=true;await assert.rejects(createReservedCheckout(input()),/expired/);assert.equal(closed,true);assert.equal(creates,0)
}))
