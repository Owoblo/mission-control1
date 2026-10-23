import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
const require=createRequire(import.meta.url)
const createLoader=require('../helpers/load-typescript.cjs')
const root=path.resolve('.')
const actor={userId:'rep',role:'manager',name:'Fixture'}
const initialQuote={id:'q',leadId:'l',number:'Q1',total:1000,deposit:200,balance:800,revision:0,paymentRecords:[],depositStripePaymentMethodId:'pm_fixture',depositStripeCustomerId:'cus_fixture'}
const initialLead={id:'l',name:'Synthetic fixture',stage:'new',callLogs:[]}
async function paymentFixture() {
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create table crm_quotes(id text primary key,data jsonb not null,deleted boolean default false,updated_at timestamptz default now());create table crm_leads(id text primary key,data jsonb not null,deleted boolean default false,updated_at timestamptz default now());`)
 for(const name of ['20260916001000_direct_payment_operations.sql','20260916001200_checkout_collection_reservations.sql','20261023000100_durable_financial_commands.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'))
 await db.query('insert into crm_quotes(id,data) values($1,$2)',['q',initialQuote]);await db.query('insert into crm_leads(id,data) values($1,$2)',['l',initialLead])
 const read=async table=>(await db.query(`select data from ${table} limit 1`)).rows[0].data
 let posts=0,collections=0,failProjection=false,failFact=false,notices=0,failNotice=false,failStripe=false
 const intents=new Map()
 const original=globalThis.fetch
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input))
  if(url.hostname==='api.stripe.com'){
   if(url.pathname.startsWith('/v1/setup_intents/')) return Response.json({id:'si_fixture',status:'succeeded',payment_method:'pm_fixture',customer:'cus_fixture',metadata:{leadId:'l',stripeAccountKey:'saturn'}})
   if(url.pathname.startsWith('/v1/payment_methods/'))return Response.json({card:{brand:'visa',last4:'4242',funding:'debit'}})
   if(init.method==='POST'&&url.pathname.startsWith('/v1/payment_intents')){
    posts++;const params=new URLSearchParams(init.body),key=init.headers['Idempotency-Key']
    assert.ok(key,'Stripe idempotency key required')
    if(!intents.has(key)){
     collections++
     const manual=params.get('capture_method')==='manual'||url.pathname.endsWith('/increment_authorization')
     const amount=Number(params.get('amount')||params.get('amount_to_capture')||0)
     intents.set(key,{id:'pi_fixture',status:url.pathname.endsWith('/cancel')?'canceled':manual?'requires_capture':'succeeded',amount,amount_received:manual?0:amount,currency:'cad',livemode:false,metadata:{quoteId:'q',leadId:'l',crmCommandId:params.get('metadata[crmCommandId]')}})
    }
    if(failStripe){failStripe=false;throw Error('Fixture network lost after collection')}
    return Response.json(intents.get(key))
   }
   throw Error('Unexpected provider request '+url.pathname)
  }
  if(url.hostname!=='database.fixture')throw Error('External access forbidden in fixture: '+url.hostname)
  const body=JSON.parse(init.body||'{}')
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1)
   assert.ok(['reserve_financial_command','apply_financial_projection'].includes(name))
   if(name==='apply_financial_projection'&&failProjection){failProjection=false;return Response.json({error:'Fixture DB down'},{status:503})}
   try{const keys=Object.keys(body);const result=await db.query(`select ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(body));return Response.json(result.rows[0].result)}catch{return Response.json({error:'Fixture conflict'},{status:409})}
  }
  if(url.pathname==='/rest/v1/crm_checkout_operations'&&!init.method)return Response.json([])
  if(url.pathname==='/rest/v1/crm_financial_commands'&&init.method==='PATCH'){
   if(body.provider_result&&failFact){failFact=false;return Response.json({error:'Fixture journal down'},{status:503})}
   const id=url.searchParams.get('id').slice(3),lease=url.searchParams.get('lease_token').slice(3),keys=Object.keys(body)
   const result=await db.query(`update crm_financial_commands set ${keys.map((k,i)=>`${k}=$${i+3}`).join(',')} where id=$1 and lease_token=$2 returning *`,[id,lease,...Object.values(body)])
   return Response.json(result.rows)
  }
  throw Error('Unexpected database request '+url.pathname)
 }
 const runtime={requireSupabaseEnv:()=>({url:'https://database.fixture',headers:{}}),getAppBaseUrl:()=> 'https://crm.fixture'}
 const account={key:'saturn',brandName:'Fixture',secretKey:'sk_test_fixture'}
 const accounts={requireStripeAccountForLead:()=>account,assertQuoteStripeAccount:()=>{},stripeErrorStatus:()=>500,appendStripeAccountMetadata:()=>{}}
 const repo={getSalesLead:()=>read('crm_leads'),getSalesQuote:()=>read('crm_quotes'),saveSalesQuote:async quote=>quote,saveSalesLead:async lead=>lead}
 const mocks={
  '@/lib/server/session':{getSessionUser:async()=>actor},'./session':{getSessionUser:async()=>actor},
  '@/lib/server/runtime':runtime,'./runtime':runtime,
  '@/lib/server/sales-permissions':{canHandleLeadPayments:()=>true},'./sales-permissions':{canHandleLeadPayments:()=>true},
  '@/lib/server/sales-repository':repo,'./sales-repository':repo,
  '@/lib/server/stripe-accounts':accounts,'./stripe-accounts':accounts,
  '@/lib/server/sales-audit':{recordLeadPaymentAudit:async()=>{},recordQuoteUpdatedAudit:async()=>{}},
  '@/lib/server/internal-notifications':{sendRepAlertEmail:async()=>{notices++;if(failNotice)throw Error('Fixture SES down')}},
  '@/lib/server/sales-messaging':{sendSalesMessage:async()=>{throw Error('Customer outreach forbidden in test')}},
  '@/lib/server/deposit-receipts':{sendDepositReceipt:async()=>{throw Error('Customer outreach forbidden in test')}},
 }
 const load=createLoader(root,mocks)
 const runKind=(kind,key='fixture-operation-001',extra={})=>load(path.join(root,`app/api/sales/stripe/${kind}/route.ts`)).POST(new Request('https://crm.fixture/api/sales/stripe/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId:'l',quoteId:'q',operationId:key,...extra})}))
 const run=(key,extra)=>runKind('charge-deposit',key,extra)
 return{db,run,runKind,read,get posts(){return posts},get collections(){return collections},get notices(){return notices},failProjection:()=>{failProjection=true},failFact:()=>{failFact=true},failStripe:()=>{failStripe=true},failNotice:()=>{failNotice=true},close:async()=>{globalThis.fetch=original;await db.close()}}
}
test('actual deposit route: DB failure after Stripe succeeds recovers with one charge and one ledger record',async()=>{
 const f=await paymentFixture();try{
  f.failProjection();assert.equal((await f.run()).status,500)
  assert.equal(f.collections,1)
  assert.equal((await f.run('fixture-other-key-002')).status,409)
  const response=await f.run();assert.equal(response.status,200)
  const body=await response.json();assert.equal(body.quote.paymentRecords.length,1);assert.equal(body.quote.paymentRecords[0].cardFunding,'debit');assert.equal(body.lead.paymentStatus,'deposit_received')
  assert.equal(f.posts,1);assert.equal(f.collections,1)
  assert.equal((await f.run()).status,200);assert.equal(f.notices,1)
  assert.equal((await f.run('fixture-new-key-003')).status,409)
 }finally{await f.close()}
})
test('actual deposit route: loss of provider response or journal write retries the same provider command',async()=>{
 for(const failure of ['failStripe','failFact']){
  const f=await paymentFixture();try{
   f[failure]();assert.equal((await f.run()).status,500)
   assert.equal((await f.run()).status,200);assert.equal(f.collections,1);assert.equal(f.posts,2)
   assert.equal((await f.read('crm_quotes')).paymentRecords.length,1)
  }finally{await f.close()}
 }
})
test('actual deposit route: concurrent submissions and notification failures cannot recollect',async()=>{
 const f=await paymentFixture();try{
  f.failNotice()
  const responses=await Promise.all([f.run(),f.run()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(f.collections,1)
  assert.equal((await f.run()).status,200);assert.equal(f.collections,1)
 }finally{await f.close()}
})
test('actual deposit route: invalid amounts and missing operation IDs never reach Stripe',async()=>{
 const f=await paymentFixture();try{
  assert.equal((await f.run('')).status,400)
  assert.equal((await f.run('fixture-overpay-001',{amountOverride:2000})).status,500)
  assert.equal(f.posts,0)
 }finally{await f.close()}
})
test('unsigned dial-status is rejected before CRM or messaging work',async()=>{
 let mutations=0
 const blocked=()=>{mutations++;throw Error('Side effect before authorization')}
 const noops=new Proxy({}, {get:()=>blocked})
 const load=createLoader(root,{
  '@/lib/server/security':{authorizeTwilioWebhook:async()=>new Response('Unauthorized',{status:401})},
  '@/lib/server/sales-alerts':noops,'@/lib/server/sales-automation':noops,'@/lib/server/sales-messaging':noops,'@/lib/server/telephony-monitoring':noops,'@/lib/server/sales-repository':noops,'@/lib/server/runtime':noops,'@/lib/server/twilio-recordings':noops,
 })
 const route=load(path.join(root,'app/api/sales/dialer/dial-status/route.ts'))
 assert.equal((await route.POST(new Request('https://crm.fixture/api/sales/dialer/dial-status',{method:'POST',body:'CallSid=CAfake&From=customer'}))).status,401)
 assert.equal(mutations,0)
})
test('unauthenticated and branch-scoped users cannot run global call backfill',async()=>{
 for(const session of [null,{userId:'rep',role:'sales_rep'},{userId:'manager',role:'manager',branch:'ottawa'}]){
  let providerReads=0
  const load=createLoader(root,{'@/lib/server/request-session':{getRequestSessionUser:async()=>session},'@/lib/server/runtime':{getTwilioCredentials:()=>{providerReads++;throw Error('Unexpected provider access')}},'@/lib/server/recording-archive':{},'@/lib/server/twilio-recordings':{},'@/lib/server/sales-repository':{}})
  const route=load(path.join(root,'app/api/sales/dialer/backfill-calls/route.ts'))
  assert.equal((await route.POST(new Request('https://crm.fixture'))).status,session?403:401);assert.equal(providerReads,0)
 }
})
test('actual SIP call sync preserves every recording and writes mappings after timeline persistence',async()=>{
 const original=globalThis.fetch
 let lead={...initialLead,phone:'+14165550123'},writes=0,mappings=0
 const sid='CA'+'a'.repeat(32)
 const provider=[{sid,from:'sip:+14165550123@sip.telnyx.com',to:'sip:+14377823004@fixture.sip.twilio.com',status:'completed',direction:'inbound',duration:'100',start_time:'2026-10-23T12:00:00Z'}]
 globalThis.fetch=async()=>Response.json({calls:provider})
 const repo={getSalesLead:async()=>lead,getSalesLeadForUpdate:async()=>({lead,updatedAt:'fixture'}),getCrmCallSidMapping:async()=>null,saveSalesLead:async next=>{writes++;lead=next;return next},saveCrmCallSidMapping:async(_sid,_lead,id)=>{assert.ok(lead.callLogs.some(log=>log.id===id));mappings++}}
 const load=createLoader(root,{'@/lib/server/request-session':{getRequestSessionUser:async()=>actor},'@/lib/server/sales-permissions':{canHandleLeadCommunications:()=>true},'@/lib/server/sales-repository':repo,'@/lib/server/lead-recording-links':{hydrateLeadRecordings:async value=>value},'@/lib/server/call-recordings':{getCallRecordingBySid:async()=>null,recordingPlaybackReference:()=>''},'@/lib/server/runtime':{getTwilioCredentials:()=>({accountSid:'fixture',authToken:'fixture'})},'@/lib/server/twilio-recordings':{twilioAuth:()=>'',findTwilioRecordingsForCall:async()=>[{recordingSid:'RE1',callSid:sid,recordingUrl:'https://recording.fixture/1',durationSeconds:100},{recordingSid:'RE2',callSid:sid,recordingUrl:'https://recording.fixture/2',durationSeconds:50}]},'@/lib/server/recording-archive':{archiveTwilioRecording:async input=>({recordingUrl:'/api/sales/dialer/recording?key='+input.recordingSid})}})
 try{
  const route=load(path.join(root,'app/api/sales/leads/[id]/sync-calls/route.ts'))
  const run=()=>route.POST(new Request('https://crm.fixture'),{params:Promise.resolve({id:'l'})})
  assert.equal((await run()).status,200);assert.equal(lead.callLogs.length,2);assert.ok(writes>0&&mappings>0)
  assert.deepEqual(new Set(lead.callLogs.map(c=>c.recordingSid)),new Set(['RE1','RE2']))
  assert.equal((await run()).status,200);assert.equal(lead.callLogs.length,2)
 }finally{globalThis.fetch=original}
})
test('recording lookup returns every parent and child resource, and does not invent a deleted recording',async()=>{
 const original=globalThis.fetch, parent='CA'+'b'.repeat(32), child='CA'+'c'.repeat(32)
 const re1='RE'+'1'.repeat(32), re2='RE'+'2'.repeat(32), re3='RE'+'3'.repeat(32)
 globalThis.fetch=async input=>{
  const url=new URL(String(input))
  if(url.pathname.endsWith(`/Calls/${parent}.json`))return Response.json({sid:parent})
  if(url.pathname.endsWith('/Calls.json'))return Response.json({calls:[{sid:child,parent_call_sid:parent}]})
  if(url.pathname.endsWith(`/Calls/${parent}/Recordings.json`))return Response.json({recordings:[{sid:re1,call_sid:parent},{sid:re2,call_sid:parent}]})
  if(url.pathname.endsWith(`/Calls/${child}/Recordings.json`))return Response.json({recordings:[{sid:re3,call_sid:child}]})
  return new Response('',{status:404})
 }
 try{
  const module=createLoader(root)(path.join(root,'lib/server/twilio-recordings.ts'))
  const found=await module.findTwilioRecordingsForCall({accountSid:'fixture',authToken:'fixture',callSid:parent})
  assert.deepEqual(new Set(found.map(r=>r.recordingSid)),new Set([re1,re2,re3]))
  assert.equal(await module.getTwilioRecordingBySid({accountSid:'fixture',authToken:'fixture',recordingSid:re1}),null)
 }finally{globalThis.fetch=original}
})
test('session failure observer never replays a card request or reacts to Stripe/login failures',async()=>{
 const original=globalThis.window,events=[];let attempts=0
 globalThis.window={location:{origin:'https://crm.fixture'},fetch:async()=>{attempts++;return new Response('',{status:401})},dispatchEvent:event=>events.push(event.type)}
 try{
  const module=createLoader(root)(path.join(root,'lib/session-recovery.ts'));const stop=module.observeSessionFailures()
  await window.fetch('/api/sales/stripe/charge-deposit',{method:'POST',body:'fixture'});assert.equal(attempts,1);assert.deepEqual(events,['crm:session-required'])
  await window.fetch('/api/auth/login',{method:'POST'});await window.fetch('https://api.stripe.com/v1/payment_intents',{method:'POST'});assert.equal(events.length,1);stop()
 }finally{globalThis.window=original}
})

test('saved-card checkout and balance capture retain funding details and survive retries',async()=>{
 const f=await paymentFixture();try{
  f.failProjection()
  const extra={setupIntentId:'si_fixture',chargeDepositNow:true}
  assert.equal((await f.runKind('save-payment-method','save-card-operation-001',extra)).status,500)
  assert.equal((await f.runKind('save-payment-method','save-card-operation-001',extra)).status,200)
  assert.equal(f.collections,1)
  assert.equal((await f.runKind('balance-authorization','hold-operation-001',{action:'authorize',amount:800,consentConfirmed:true})).status,200)
  assert.equal((await f.read('crm_quotes')).balanceAuthorizationStatus,'authorized')
  assert.equal((await f.runKind('balance-authorization','hold-operation-002',{action:'authorize',amount:800,consentConfirmed:true})).status,409)
  f.failProjection()
  assert.equal((await f.runKind('charge-balance','capture-operation-001')).status,500)
  assert.equal((await f.runKind('charge-balance','capture-operation-001')).status,200)
  assert.equal(f.collections,3)
  const quote=await f.read('crm_quotes');assert.equal(quote.balanceAuthorizationStatus,'captured');assert.equal(quote.balance,0);assert.equal(quote.paymentRecords.length,2)
  assert.equal(quote.paymentRecords[1].cardFunding,'debit');assert.equal((await f.read('crm_leads')).paymentStatus,'paid_in_full')
 }finally{await f.close()}
})
test('authorization capture and cancellation use durable operations without replacing the hold flow',async()=>{
 for(const action of ['capture','cancel']){
  const f=await paymentFixture();try{
   assert.equal((await f.run()).status,200)
   assert.equal((await f.runKind('balance-authorization','hold-authorization-001',{action:'authorize',amount:800,consentConfirmed:true})).status,200)
   f.failProjection()
   assert.equal((await f.runKind('balance-authorization','hold-finalize-001',{action,amount:800})).status,500)
   assert.equal((await f.runKind('balance-authorization','hold-finalize-001',{action,amount:800})).status,200)
   assert.equal(f.collections,3)
   assert.equal((await f.read('crm_quotes')).balanceAuthorizationStatus,action==='capture'?'captured':'canceled')
  }finally{await f.close()}
 }
})
test('actual middleware separates signed callbacks, staff tools, native partnership roles, and cron authentication',async()=>{
 const secret=process.env.AUTH_SECRET,cron=process.env.CRON_SECRET
 process.env.AUTH_SECRET='isolated-middleware-fixture';process.env.CRON_SECRET='isolated-cron-fixture'
 try{
  const load=createLoader(root),auth=load(path.join(root,'lib/auth.ts')),middleware=load(path.join(root,'middleware.ts')).middleware
  const {NextRequest}=require('next/server')
  const run=(route,token,method='POST')=>middleware(new NextRequest('https://crm.fixture'+route,{method,headers:token?{Authorization:'Bearer '+token}:{}}))
  for(const route of ['backfill-calls','token','conference','transfer-context','recording'])assert.equal((await run('/api/sales/dialer/'+route)).status,401)
  assert.equal((await run('/api/sales/dialer/dial-status')).status,200)
  const partner=await auth.createSessionToken({userId:'partner',role:'partnership_manager'})
  assert.equal((await run('/api/sales/dialer/conference',partner)).status,200)
  assert.equal((await run('/api/sales/dialer/backfill-calls',partner)).status,403)
  assert.equal((await run('/api/sales/stripe/charge-deposit',partner)).status,403)
  const roleless=await auth.createSessionToken({userId:'legacy'})
  assert.equal((await run('/api/sales/leads',roleless)).status,401)
  const config=JSON.parse(readFileSync('vercel.json','utf8'))
  for(const {path:route}of config.crons.filter(job=>/^\/api\/(sales|marketing)\//.test(job.path))){
   assert.equal((await run(route,'isolated-cron-fixture','GET')).status,200,route)
   assert.notEqual((await run(route,undefined,'GET')).status,200,route)
  }
 }finally{if(secret===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=secret;if(cron===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=cron}
})
test('session renewal uses current database permissions and never extends deleted or legacy accounts',async()=>{
 const original=globalThis.fetch;let reads=0
 const load=createLoader(root,{'./runtime':{requireSupabaseEnv:()=>({url:'https://database.fixture',headers:{}})}})
 const profile=load(path.join(root,'lib/server/session-profile.ts')).currentSessionProfile
 try{
  globalThis.fetch=async()=>{reads++;return Response.json([{id:'rep',name:'Fixture',role:'crew',branch:'ottawa'}])}
  const current=await profile({exp:Date.now()+1000,userId:'rep',role:'manager',branch:'toronto'})
  assert.equal(current.identity.role,'crew');assert.equal(current.identity.branch,'ottawa');assert.equal(current.renewable,true)
  globalThis.fetch=async()=>Response.json([])
  assert.equal(await profile({exp:Date.now()+1000,userId:'deleted',role:'manager'}),null)
  const legacy=await profile({exp:Date.now()+1000,userId:'legacy-owner',role:'owner'})
  assert.equal(legacy.renewable,false);assert.equal(reads,1)
 }finally{globalThis.fetch=original}
})
