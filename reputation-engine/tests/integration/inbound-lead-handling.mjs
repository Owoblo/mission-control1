import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.')
const phone='+19055550123',line='+15484883245'

test('actual missed-call handler uses shared reservation across cold starts and still preserves each call reference',async()=>{
 let responses=0,alerts=0;const cards=[],intake=[],reservations=[],pending=[]
 const mocks={
  'next/server':{after:fn=>pending.push(fn)},
  '@/lib/server/security':{authorizeTwilioWebhook:async()=>null},
  '@/lib/server/carrier-voice':{carrierVoiceForm:raw=>new URLSearchParams(raw)},
  '@/lib/server/interactions':{captureTwilioInteraction:async()=>{}},
  '@/lib/server/dialer-settings':{getDialerSettings:async()=>({}),findBlockedCaller:()=>false},
  '@/lib/server/runtime':{getAppBaseUrl:()=> 'https://crm.fixture'},
  '@/lib/server/sales-repository':{saveInboundLead:async row=>intake.push(row)},
  '@/lib/server/sales-automation':{processInboundAutomationEvent:async()=>{responses++}},
  '@/lib/server/internal-notifications':{sendRepAlertEmail:async()=>{alerts++},missedCallNotificationEmail:()=> 'fixture'},
  '@/lib/server/inbound-call-history':{persistInboundCallEvent:async event=>cards.push(event),reserveMissedCallResponse:async(...args)=>{reservations.push(args);return reservations.length===1}},
 }
 for(const call of ['CAfirst','CAsecond','CAfirst']){
  const route=createLoader(root,mocks)(path.join(root,'app/api/sales/dialer/missed-call/route.ts'))
  const response=await route.POST(new Request('https://crm.fixture/api/sales/dialer/missed-call',{method:'POST',body:new URLSearchParams({From:phone,To:line,CallSid:call,DialCallStatus:'no-answer'}).toString()}))
  assert.equal(response.status,200);assert.match(await response.text(),/<Record/)
  await pending.shift()()
 }
 assert.equal(responses,1);assert.equal(cards.length,3);assert.equal(alerts,3)
 assert.deepEqual(intake.map(x=>x.raw_data.callSid),['CAfirst','CAsecond','CAfirst'])
 assert.deepEqual(reservations[0],[phone,line,'CAfirst'])
})

test('voicemail work is registered after the response and attaches to the exact provider call',async()=>{
 const pending=[],writes=[],cards=[];let alerts=0
 const load=createLoader(root,{
  'next/server':{after:fn=>pending.push(fn)},
  '@/lib/server/security':{authorizeTwilioWebhook:async()=>null},
  '@/lib/server/carrier-voice':{carrierVoiceForm:raw=>new URLSearchParams(raw)},
  '@/lib/server/interactions':{captureTwilioInteraction:async()=>{}},
  '@/lib/server/sales-repository':{saveInboundLead:async row=>writes.push(row),getInboundLeadByCallSid:async sid=>{assert.equal(sid,'CAfirst');return{raw_data:{linkedLeadId:'lead'}}}},
  '@/lib/server/inbound-call-history':{persistInboundCallEvent:async event=>{cards.push(event);return{leadId:'lead',callLogId:'call'}}},
  '@/lib/server/runtime':{getTwilioCredentials:()=>({accountSid:'fixture',authToken:'fixture'})},
  '@/lib/server/recording-archive':{archiveTwilioRecording:async input=>{assert.equal(input.recordingSid,'REfirst');assert.equal(input.leadId,'lead')}},
  '@/lib/server/internal-notifications':{sendRepAlertEmail:async()=>{alerts++},voicemailNotificationEmail:()=> 'fixture'},
 })
 const route=load(path.join(root,'app/api/sales/dialer/voicemail/route.ts'))
 const response=await route.POST(new Request('https://crm.fixture/api/sales/dialer/voicemail',{method:'POST',body:new URLSearchParams({From:phone,To:line,CallSid:'CAfirst',RecordingSid:'REfirst',RecordingDuration:'37',RecordingUrl:'https://api.twilio.com/fixture'}).toString()}))
 assert.equal(response.status,200);assert.equal(pending.length,1);assert.equal(writes.length,0)
 await pending[0]();assert.equal(writes[0].raw_data.callSid,'CAfirst');assert.equal(writes[0].raw_data.voicemailDuration,37);assert.equal(cards.length,1);assert.equal(alerts,1)
})

test('actual SMS sender permits a fresh customer reply within 60 seconds while suppressing a retry of that reply',async()=>{
 const original=globalThis.fetch;const priorAt=new Date(Date.now()-40000).toISOString(),inboundAt=new Date(Date.now()-20000).toISOString();let posts=0
 const sms=[{direction:'outbound',body:'What date is your move?',created_at:priorAt}]
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));assert.equal(url.hostname,'database.fixture')
  if(init.method==='POST'){sms.push({...JSON.parse(init.body),created_at:new Date().toISOString()});return Response.json([])}
  const after=url.searchParams.get('created_at').slice(4)
  return Response.json(sms.filter(x=>x.created_at>=after))
 }
 const runtime={requireSupabaseEnv:()=>({url:'https://database.fixture',headers:{}}),getTwilioCredentials:()=>({accountSid:'fixture',authToken:'fixture'})}
 const load=createLoader(root,{
  '@/lib/server/dialer-settings':{getDialerSettings:async()=>({}),findBlockedCaller:()=>false},
  './destination-realtor-send-guard':{assertDestinationRealtorSend:async()=>{}},
  '@/lib/server/email-provider':{},'@/lib/server/runtime':runtime,
  '@/lib/server/sms-provider':{sendSmsProviderRequest:async()=>{posts++;return Response.json({sid:'SMfixture'})}},
  '@/lib/server/voice-caller-id':{resolveVoiceCallerId:async()=>({fromNumber:line})},
  '@/lib/server/call-intelligence':{summarizeMessage:async()=>null},'@/lib/server/analytics':{logEvent:async()=>{}},
  '@/lib/server/sales-repository':{getSalesLead:async()=>null,saveFollowUpLog:async log=>log},
 })
 try{
  const {sendSalesMessage}=load(path.join(root,'lib/server/sales-messaging.ts'))
  const input={channel:'sms',to:phone,body:'Thanks. What is the pickup address?',leadId:'lead',actor:'automation',replyToInboundAt:inboundAt}
  assert.equal((await sendSalesMessage(input)).deduped,undefined);assert.equal(posts,1)
  assert.equal((await sendSalesMessage(input)).deduped,true);assert.equal(posts,1)
 }finally{globalThis.fetch=original}
})

test('historical voicemail playback requires exact ingress evidence and branch permission',async()=>{
 for(const [allowed,evidence,expected] of [[true,true,200],[true,false,403],[false,true,403]]){
  let downloads=0
  const lead={id:'lead',name:'Fixture',phone,stage:'new',createdAt:'2026-10-24',callLogs:[]}
  const load=createLoader(root,{
   '@/lib/server/request-session':{getRequestSessionUser:async()=>({role:'sales_rep',userId:'rep',branch:'london'})},
   '@/lib/server/sales-permissions':{canHandleLeadCommunications:()=>allowed},
   '@/lib/server/sales-repository':{getSalesLead:async()=>lead,getCrmCallSidMapping:async()=>null},
   '@/lib/server/runtime':{getTwilioCredentials:()=>({accountSid:'fixture',authToken:'fixture'})},
   '@/lib/server/call-recordings':{getCallRecordingBySid:async()=>null},
   '@/lib/server/twilio-recordings':{normalizeTwilioRecordingSid:s=>s,normalizeTwilioRecordingMediaUrl:()=>null,buildTwilioRecordingMediaUrl:()=> 'https://api.twilio.com/fixture',getTwilioRecordingBySid:async()=>null,downloadTwilioRecording:async()=>{downloads++;return{buffer:Buffer.from('fixture'),contentType:'audio/mpeg'}}},
   '@/lib/server/storage-service':{},
   '@/lib/server/inbound-call-history':{listInboundCallEvents:async()=>evidence?[{event:{source:'twilio_voicemail',channel:'voicemail',sender:phone,recipient:line,occurredAt:'2026-10-24T16:14:20Z',provenance:{CallSid:'CAfirst',RecordingSid:'REfirst'}}}]:[]},
  })
  const response=await load(path.join(root,'app/api/sales/dialer/recording/route.ts')).GET(new Request('https://crm.fixture/api/sales/dialer/recording?sid=REfirst&leadId=lead'))
  assert.equal(response.status,expected);assert.equal(downloads,expected===200?1:0)
 }
})
