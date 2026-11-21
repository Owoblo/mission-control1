import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeDirectPayment, assertSuccessfulIntent, reconcileDirectPayment } from '../../lib/server/direct-payment-operation'
import type { CRMLead,CRMQuote } from '../../lib/types'
const quote:CRMQuote={id:'q',leadId:'l',number:'Q1',clientId:'c',status:'accepted',lineItems:[],subtotal:1000,hst:0,total:1000,deposit:250,balance:1000,createdAt:'2026-01-01'}
const lead:CRMLead={id:'l',name:'Test',stage:'tentative',createdAt:'2026-01-01'}
const baseOp={id:'00000000-0000-4000-8000-000000000001',quote_id:'q',lead_id:'l',amount_minor:25000,currency:'cad',state:'reserved'}
const intent={id:'pi_test',status:'succeeded',amount:25000,amount_received:25000,currency:'cad',livemode:false,metadata:{ssmOperationId:baseOp.id,quoteId:'q',leadId:'l'}}
function input(){return {operationKey:'test-operation-000001',kind:'deposit' as const,quote,lead,amount:250,account:'saturn' as const,stripeKey:'sk_test_fixture_not_a_real_key',params:new URLSearchParams({payment_method:'pm_test',amount:'25000',currency:'cad'})}}
async function sandbox(fn:()=>Promise<void>){const fetcher=global.fetch;const prior=[process.env.SUPABASE_URL,process.env.SUPABASE_KEY];process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_KEY='test-only';try{await fn()}finally{global.fetch=fetcher;for(const [i,key] of ['SUPABASE_URL','SUPABASE_KEY'].entries()){if(prior[i]===undefined)delete process.env[key];else process.env[key]=prior[i]}}}
test('Successful provider fact must match operation amount, currency, account mode and metadata',()=>{
 assert.doesNotThrow(()=>assertSuccessfulIntent(intent,baseOp,false))
 for(const patch of [{amount:26000},{amount_received:0},{currency:'usd'},{livemode:true},{status:'processing'},{metadata:{...intent.metadata,quoteId:'other'}}])assert.throws(()=>assertSuccessfulIntent({...intent,...patch},baseOp,false))
})
test('Provider timeout is durable unknown; retry never submits a second charge',()=>sandbox(async()=>{
 let reserved=false;let op={...baseOp};let calls=0
 global.fetch=async(url,init)=>{
  const path=String(url)
  if(path.includes('rpc/reserve_direct_payment')){const created=!reserved;reserved=true;return Response.json({created,operation:op})}
  if(path.includes('crm_payment_operations?')){op={...op,...JSON.parse(String(init?.body))};return Response.json([op])}
  if(path.includes('api.stripe.com')){calls++;throw new Error('Timeout')}
  throw new Error('Unexpected request')
 }
 await assert.rejects(executeDirectPayment(input()),/unresolved/)
 assert.equal(op.state,'unknown')
 await assert.rejects(executeDirectPayment(input()),/reconciliation/)
 assert.equal(calls,1)
}))
test('Provider success followed by DB failure is recovered without recollecting',()=>sandbox(async()=>{
 let reserved=false;let op:any={...baseOp};let submissions=0;let applyAttempts=0
 global.fetch=async(url,init)=>{
  const path=String(url)
  if(path.includes('rpc/reserve_direct_payment')){const created=!reserved;reserved=true;return Response.json({created,operation:op})}
  if(path.includes('crm_payment_operations?')){op={...op,...JSON.parse(String(init?.body))};return Response.json([op])}
  if(path.endsWith('/payment_intents')){submissions++;assert.equal((init?.headers as any)['Idempotency-Key'],`ssm-direct-${op.id}`);return Response.json(intent)}
  if(path.includes('/payment_intents/pi_test'))return Response.json(intent)
  if(path.includes('/payment_methods/'))return Response.json({card:{brand:'visa',last4:'4242'}})
  if(path.includes('rpc/apply_direct_payment')){
   applyAttempts++;if(applyAttempts===1)return new Response(null,{status:503})
   const record=JSON.parse(String(init?.body)).p_record
   return Response.json({quote:{...quote,revision:1,balance:750,paymentRecords:[record]},lead:{...lead,paymentStatus:'deposit_received'},replayed:false})
  }
  throw new Error('Unexpected request '+path)
 }
 await assert.rejects(executeDirectPayment(input()),/Payment storage/)
 assert.equal(op.state,'provider_succeeded')
 const result=await executeDirectPayment(input())
 assert.equal(result.quote.paymentRecords?.length,1);assert.equal(submissions,1);assert.equal(applyAttempts,2)
}))
test('Missing operation storage fails before contacting Stripe',()=>sandbox(async()=>{
 let providerCalls=0
 global.fetch=async url=>{if(String(url).includes('api.stripe.com'))providerCalls++;return new Response(null,{status:404})}
 await assert.rejects(executeDirectPayment(input()),/Payment storage/);assert.equal(providerCalls,0)
}))
test('Uncertain reconciliation with no search result never creates or confirms a payment',()=>sandbox(async()=>{
 let writes=0
 global.fetch=async(url,init)=>{
  if(init?.method&&init.method!=='GET')writes++
  return Response.json(String(url).includes('api.stripe.com')?{data:[]}:[{...baseOp,state:'unknown',kind:'deposit'}])
 }
 const result=await reconcileDirectPayment({operationId:baseOp.id,quote,lead,account:'saturn',stripeKey:'sk_test_fixture_not_a_real_key'})
 assert.equal(result.state,'unknown');assert.equal(writes,0)
}))
