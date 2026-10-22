import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

function load(route: 'twiml'|'call-status', authorized=true) {
 const effects:string[]=[]
 const line={number:'+14374650584',market:'toronto',label:'Toronto partnerships',cityKeys:['toronto']}
 const modules:Record<string,unknown>={
  '@/lib/server/carrier-voice':{carrierVoiceForm:(raw:string)=>new URLSearchParams(raw),carrierDialTarget:(to:string)=>`<Number>${to}</Number>`},
  '@/lib/server/interactions':{captureTwilioInteraction:async()=>{effects.push('captured')}},
  '@/lib/server/security':{authorizeTwilioWebhook:async()=>authorized?null:new Response('',{status:403})},
  '@/lib/server/partnership-phone-policy':{reservePartnershipCall:async()=>{throw Error('Inbound must not reserve outbound call')}},
  '@/lib/sales-phones':{normalizePhone:(v:string)=>v},
  '@/lib/server/partnership-inbound':{pausePartnershipSequenceForInbound:async()=>({matched:false})},
  '@/lib/server/runtime':{getAppBaseUrl:()=> 'https://app.test',readEnv:(key:string)=>key==='PARTNERSHIP_FORWARD_PHONE'?'+12265550100':'',requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})},
  '@/lib/partnership-lines':{DEFAULT_PARTNERSHIP_FROM_NUMBER:line.number,PARTNERSHIP_LINES:[line],getPartnershipPrimaryNumberForMarket:()=>line.number,normalizePartnershipCityKey:(v:string)=>v||'',isPartnershipSenderNumber:(v:string)=>v===line.number},
  '@/lib/server/internal-notifications':{getPartnershipAlertRecipients:()=>['owner@example.test'],partnershipInboundCallNotificationEmail:(data:{caller:string})=>data.caller,sendRepAlertEmail:async(_subject:string,body:string)=>{effects.push('alert:'+body)}},
 }
 const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync(`app/api/marketing/dialer/${route}/route.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:(id:string)=>{if(!(id in modules))throw Error(id);return modules[id]},URL,URLSearchParams,Response,console,fetch:async(url:string,init?:RequestInit)=>{
    if(route==='call-status'&&url.includes('/market_contacts?')&&!init?.method){effects.push('lookup');return Response.json([])}
    if(route==='call-status'&&url.endsWith('/market_contacts')&&init?.method==='POST'){effects.push('created-contact');return Response.json([{id:'unknown-contact',name:'Unknown inbound caller +14165550123',phone:'+14165550123',city:'Toronto',stage:'attempting_contact'}])}
    if(route==='call-status'&&url.includes('/market_touches')){effects.push('saved-touch');return Response.json([])}
    if(route==='call-status'&&url.includes('/market_contacts?id=')){effects.push('updated-contact');return Response.json([])}
    effects.push('unexpected-fetch');return Response.json([])
  }})
 return {post:exports.POST as (request:Request)=>Promise<Response>,effects}
}
function request(status='completed',duration='60',dialStatus=status,dialDuration=duration,bridged=String(status==='completed')) {return new Request('https://app.test/hook',{method:'POST',body:new URLSearchParams({From:'+14165550123',To:'+14374650584',CallSid:'CAtest',Direction:'inbound',CallStatus:status,CallDuration:duration,DialCallStatus:dialStatus,DialCallDuration:dialDuration,DialBridged:bridged})})}
test('unknown partnership caller is captured and forwarded without a contact or rep',async()=>{
 const {post,effects}=load('twiml');const response=await post(request());const xml=await response.text();assert.equal(response.status,200);assert.match(xml,/<Number>\+12265550100<\/Number>/);assert.match(xml,/recordingStatusCallback=/);assert.match(xml,/call-status/);assert.equal(effects[0],'captured');assert.ok(!effects.includes('no-contact'))
})
for(const [status,duration,dialStatus,dialDuration,bridged] of [['completed','60','completed','60','true'],['in-progress','30','no-answer','0','false']])test(`unknown ${dialStatus} call is retained and alerts owner with final Dial result`,async()=>{
 const {post,effects}=load('call-status');const response=await post(request(status,duration,dialStatus,dialDuration,bridged));assert.equal(response.status,200);assert.match(await response.text(),/<Hangup\/>/);assert.ok(effects.includes('alert:+14165550123'));assert.ok(effects.includes('created-contact'));assert.ok(effects.includes('saved-touch'))
})
test('non-terminal outer in-progress event is captured without a missed-call alert',async()=>{
 const {post,effects}=load('call-status');await post(request('in-progress','5','','0','false'));assert.deepEqual(effects,['captured'])
})
test('unsigned unknown calls cannot trigger forwarding or alerts',async()=>{
 for(const route of ['twiml','call-status'] as const){const {post,effects}=load(route,false);assert.equal((await post(request())).status,403);assert.deepEqual(effects,[])}
})
