import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'
const require=createRequire(import.meta.url),createLoader=require('../helpers/load-typescript.cjs'),root=path.resolve('.')
const runtime={requireSupabaseEnv:()=>({url:'https://database.fixture',headers:{}})}

test('Twilio status callback rejects unsigned receipts before storage and validates provider references',async()=>{
 const load=createLoader(root,{'@/lib/server/security':{authorizeTwilioWebhook:async()=>Response.json({error:'Unauthorized'},{status:401})},'@/lib/server/runtime':{requireSupabaseEnv:()=>{throw Error('unauthorized storage access')}}})
 const route=load(path.join(root,'app/api/sales/twilio/sms-status/route.ts'))
 assert.equal((await route.POST(new Request('https://crm.fixture/api/sales/twilio/sms-status',{method:'POST',body:'MessageSid=SMfake&MessageStatus=failed'}))).status,401)
 const valid=createLoader(root,{'@/lib/server/security':{authorizeTwilioWebhook:async()=>null},'@/lib/server/runtime':runtime})(path.join(root,'app/api/sales/twilio/sms-status/route.ts'))
 assert.equal((await valid.POST(new Request('https://crm.fixture',{method:'POST',body:'MessageSid=SMfake&MessageStatus=failed'}))).status,400)
})
test('Twilio receipt stores a repeatable event identity and carrier failure detail',async()=>{
 const original=globalThis.fetch;let body
 globalThis.fetch=async(input,init)=>{assert.equal(new URL(input).pathname,'/rest/v1/crm_sms_provider_events');body=JSON.parse(init.body);return new Response(null,{status:201})}
 try {
  const route=createLoader(root,{'@/lib/server/security':{authorizeTwilioWebhook:async()=>null},'@/lib/server/runtime':runtime})(path.join(root,'app/api/sales/twilio/sms-status/route.ts'))
  const sid='SM'+'a'.repeat(32),form=new URLSearchParams({MessageSid:sid,MessageStatus:'undelivered',ErrorCode:'30003',ErrorMessage:'Unreachable destination'})
  assert.equal((await route.POST(new Request('https://crm.fixture',{method:'POST',body:form}))).status,200)
  assert.equal(body.message_key,sid);assert.equal(body.event_id,`twilio:${sid}:undelivered:30003`);assert.equal(body.payload.errors[0].code,'30003')
 }finally{globalThis.fetch=original}
})
test('virtual partner handoffs and noncustomer records cannot take ownership of a Sales SMS reply',async()=>{
 const original=globalThis.fetch
 try{for(const [id,data,expected]of [['partner-handoff-partner',{},null],['lead-partner',{leadKind:'realtor_opportunity'},null],['lead-archived',{conversationReview:{kind:'no_active_move',status:'open'}},null],['lead-customer',{leadKind:'customer'},'lead-customer']]){
  globalThis.fetch=async input=>{const u=new URL(input);if(u.pathname.endsWith('sms_messages'))return Response.json([{lead_id:id,twilio_sid:'SMfixture',from_number:'+14377823004',to_number:'+14164365543',direction:'outbound'}]);if(u.pathname.endsWith('market_touches'))return Response.json([]);if(u.pathname.endsWith('crm_leads'))return Response.json([{id,data,deleted:false}]);throw Error('Unexpected ownership request')}
  const get=createLoader(root,{'@/lib/server/runtime':runtime})(path.join(root,'lib/server/partnership-message-context.ts')).getSalesSmsReplyLeadId
  assert.equal(await get('+14164365543','+14377823004'),expected)
 }}finally{globalThis.fetch=original}
})
test('recording worker preserves playable archive and schedules bounded retry when transcription quota fails',async()=>{
 const original=globalThis.fetch,sid='RE'+'a'.repeat(32),patches=[]
 globalThis.fetch=async(input,init)=>{const url=new URL(input),body=JSON.parse(init.body);if(url.pathname.endsWith('claim_crm_recording_jobs'))return Response.json([{recording_sid:sid,lease_token:'lease',attempts:1}]);patches.push({path:url.pathname,query:url.search,body});return Response.json([{}])}
 const lead={id:'lead',createdAt:'2026-10-24',callLogs:[{id:'call',date:'2026-10-24T13:00Z',recordingSid:sid,direction:'outbound'}]}
 try{
  const load=createLoader(root,{'./runtime':runtime,'./call-recordings':{getCallRecordingBySid:async()=>({recording_sid:sid,twilio_call_sid:'CAfixture',lead_id:'lead',cloudflare_object_key:'recordings/fixture.mp3'})},'./sales-repository':{getCrmCallSidMapping:async()=>({leadId:'lead',callLogId:'call'}),getSalesLeadForUpdate:async()=>({lead,updatedAt:'2026-10-24'}),saveSalesLead:async()=>lead,getSalesLead:async()=>lead},'./storage-service':{getStorageService:()=>({getObject:async()=>({buffer:Buffer.from('fixture'),contentType:'audio/mpeg'})})},'./call-intelligence':{transcribeAudioBuffer:async(buffer,type,prefix,options)=>{assert.deepEqual(options,{timeoutMs:120000,attempts:1});throw Error('Transcription quota exhausted')}},'./conversation-integrity':{}})
  const result=await load(path.join(root,'lib/server/recording-processing.ts')).processRecordingJobs(1)
  assert.equal(result[0].status,'retry');assert.ok(patches.some(p=>p.body.state==='retry'&&p.body.lease_token===null));assert.ok(patches.some(p=>p.body.transcription_status==='retry'))
  assert.equal(patches.some(p=>'cloudflare_object_key'in p.body),false)
  assert.equal(patches.some(p=>p.path.includes('sms')||p.path.includes('automation')),false)
 }finally{globalThis.fetch=original}
})

test('a known partner replying on the Sales line stays with Partnerships without customer qualification',async()=>{
 let routed=0,automation=0,intakes=0
 const load=createLoader(root,{
  'next/server':{after:()=>{throw Error('Partner reply must not enter Sales automation')}},
  '@/lib/server/runtime':runtime,
  '@/lib/server/dialer-settings':{findBlockedCaller:()=>false,getDialerSettings:async()=>({})},
  '@/lib/server/interactions':{captureTwilioInteraction:async()=>{}},
  '@/lib/server/partnership-inbound':{archiveOwnerIgnoredPartnershipInbound:async()=>false,pausePartnershipSequenceForInbound:async input=>{routed++;assert.equal(input.metadata.to,'+14377823004');return{matched:true}}},
  '@/lib/server/partnership-message-context':{getSalesSmsReplyLeadId:async()=>null},
  '@/lib/server/contractor-inbound':{findInboundContractor:async()=>null},
  '@/lib/server/partnership-routing-review':{isAutomatedLeasingNotice:()=>false,needsPartnershipRoutingReview:()=>false},
  '@/lib/server/sales-automation':{processInboundAutomationEvent:async()=>{automation++}},
  '@/lib/server/sales-repository':{saveInboundLead:async()=>{intakes++}},
  '@/lib/server/analytics':{logEvent:async()=>{}},'@/lib/server/lead-media':{},'@/lib/server/internal-notifications':{},'@/lib/server/security':{},
 })
 const result=await load(path.join(root,'lib/server/inbound-sms.ts')).handleInboundSms(new URLSearchParams({From:'+14164365543',To:'+14377823004',Body:"There's no current move date",MessageSid:'SMfixture'}))
 assert.equal(result.status,200);assert.equal(routed,1);assert.equal(automation,0);assert.equal(intakes,0)
})
