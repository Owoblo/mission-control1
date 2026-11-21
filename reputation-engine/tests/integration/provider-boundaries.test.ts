import test from 'node:test'
import { promises as dns } from 'node:dns'
import { reserveAction } from '../../lib/partnership-core/reserve.mjs'
import assert from 'node:assert/strict'
import { SESv2Client } from '@aws-sdk/client-sesv2'
import { POST } from '../../app/api/marketing/sequence/process/route'
import { sendSalesMessage } from '../../lib/server/sales-messaging'
import { sendOutreachEmail } from '../../lib/server/email-provider'

test('SES outreach queue is independent of Resend and suspended/missing Twilio; missing SES fails only that job', async () => {
 const keys=['CRON_SECRET','SUPABASE_URL','SUPABASE_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SES_PRODUCTION_ACCESS_CONFIRMED','RESEND_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','PARTNERSHIP_EMAIL_PROVIDER','PARTNERSHIP_EMAIL','ZEROBOUNCE_API_KEY']
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k])
 Object.assign(process.env,{CRON_SECRET:'fixture',SUPABASE_URL:'https://db.invalid',SUPABASE_KEY:'fixture',AWS_ACCESS_KEY_ID:'fixture',AWS_SECRET_ACCESS_KEY:'fixture',SES_PRODUCTION_ACCESS_CONFIRMED:'true',ZEROBOUNCE_API_KEY:'fixture',PARTNERSHIP_EMAIL_PROVIDER:'resend',PARTNERSHIP_EMAIL:'business@starmovers.ca'})
 const originalMx=dns.resolveMx;dns.resolveMx=async()=>[{exchange:'mx.invalid',priority:10}]
 const original=globalThis.fetch, originalSes=SESv2Client.prototype.send
 let sends=0, failed=0
 SESv2Client.prototype.send=(async(command:any)=>{if(command.constructor.name==='GetAccountCommand')return {SendingEnabled:true,ProductionAccessEnabled:true,EnforcementStatus:'HEALTHY'};sends++;return {MessageId:'ses-fixture'}}) as typeof originalSes
 const contact={id:'contact',email:'buyer@example.invalid',name:'Example',city:'Windsor'}
 const job={id:'email-job',contact_id:contact.id,channel:'email',status:'pending',scheduled_at:new Date().toISOString()}
 globalThis.fetch=async(input,options)=>{
  const u=new URL(String(input)),method=options?.method||'GET'
  if(u.hostname==='api.zerobounce.net') return Response.json({status:'valid'})
  assert.equal(u.hostname,'db.invalid','email queue must not call another transport provider')
  if(u.pathname.endsWith('sequence_jobs')){
   if(method==='GET')return Response.json([job])
   const body=JSON.parse(String(options?.body));if(body.error)failed++
   return Response.json([{...job,...body}])
  }
  if(u.pathname.endsWith('rpc/reserve_partnership_action'))return Response.json({allowed:true,reasons:[]})
  if(u.pathname.endsWith('partnership_policy_events'))return Response.json([])
  if(u.pathname.endsWith('market_contacts'))return Response.json([contact])
  if(u.pathname.endsWith('market_touches'))return Response.json([])
  throw Error('Unexpected '+u.pathname)
 }
 try {
  const request=()=>new Request('https://app.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'}})
  assert.equal((await (await POST(request())).json()).processed,1)
  Object.assign(process.env,{TWILIO_ACCOUNT_SID:'ACsuspended',TWILIO_AUTH_TOKEN:'fixture'})
  assert.equal((await (await POST(request())).json()).processed,1)
  await reserveAction({url:'https://db.invalid',headers:{},contactId:'contact',channel:'email',key:'test-email-reservation',content:'Test',sender:'business@starmovers.ca',emailProvider:'ses'})
  delete process.env.AWS_SECRET_ACCESS_KEY
  assert.equal((await (await POST(request())).json()).processed,0)
  assert.equal(sends,2);assert.ok(failed>0)
  await assert.rejects(sendOutreachEmail({from:'x@example.invalid',to:'y@example.invalid',subject:'Test',text:'Test'}),/AWS/)
 } finally {dns.resolveMx=originalMx;globalThis.fetch=original;SESv2Client.prototype.send=originalSes;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
})

test('customer/quote email uses Resend without SES or Twilio credentials', async()=>{
 const keys=['RESEND_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SES_PRODUCTION_ACCESS_CONFIRMED','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','SUPABASE_URL','SUPABASE_KEY']
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);Object.assign(process.env,{RESEND_API_KEY:'fixture',SUPABASE_URL:'https://db.invalid',SUPABASE_KEY:'fixture'})
 const original=globalThis.fetch;let calls=0
 globalThis.fetch=async(input,options)=>{
  const u=new URL(String(input))
  if(u.hostname==='api.resend.com'){calls++;return Response.json({id:'resend-fixture'})}
  assert.equal(u.hostname,'db.invalid')
  return Response.json(options?.body?[JSON.parse(String(options.body))]:[])
 }
 try {const result=await sendSalesMessage({channel:'email',to:'buyer@example.invalid',subject:'Quote',body:'Your quote',quoteId:'fixture-quote'});assert.equal(result.ok,true);assert.equal(calls,1)}
 finally {globalThis.fetch=original;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
})
