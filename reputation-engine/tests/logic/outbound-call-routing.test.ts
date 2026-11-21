import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
function handler(deny=false,source='app/api/sales/dialer/twiml/route.ts') {
 const exports:any={}
 const mocks:any={
  '@/lib/server/carrier-voice':{carrierVoiceForm:(raw:string)=>new URLSearchParams(raw),carrierDialTarget:(to:string)=>`<Number>${to}</Number>`},
  '@/lib/server/security':{authorizeTwilioWebhook:async()=>null},
  '@/lib/server/runtime':{getAppBaseUrl:()=> 'https://crm.test'},
  '@/lib/server/voice-caller-id':{resolveVoiceCallerId:async()=>({fromNumber:'+12268870667'})},
  '@/lib/server/partnership-phone-policy':{reservePartnershipCall:async()=>{if(deny)throw Error('policy hold')}},
  '@/lib/sales-phones':{getDefaultSaturnBranchNumber:()=>'+12267732993',getSaturnBranchLabel:()=>'',getSaturnTrackingSource:()=> 'partnership_outreach'},
 }
 const forbidden=new Proxy({}, {get:()=>()=>{throw Error('Unexpected dependency')}})
 runInNewContext(ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:(id:string)=>mocks[id]||forbidden,Request,Response,URL,URLSearchParams,console:{error:()=>{}}})
 return exports.POST
}
function request(to='+15195550123'){return new Request('https://crm.test/api/sales/dialer/twiml',{method:'POST',body:new URLSearchParams({From:'client:saturn-rep-owner',To:to,CallSid:'CA'+'1'.repeat(32),PreferredFromNumber:'+12268870667'})})}
for(const [label,path] of [['routing',process.env.SSM_ROUTING_TEST_SOURCE || 'app/api/sales/dialer/twiml/route.ts']]) {
 test(label+': permitted outbound call targets the requested customer',async()=>{const xml=await(await handler(false,path)(request())).text();assert.match(xml,/<Number>\+15195550123<\/Number>/);assert.doesNotMatch(xml,/<Sip>/)})
 test(label+': a policy hold never loops an outbound caller into SIP reps',async()=>{const xml=await(await handler(true,path)(request())).text();assert.match(xml,/<Hangup\/>/);assert.doesNotMatch(xml,/<Dial|<Sip>|<Client>/)})
 test(label+': missing destination cannot dial internal fallback',async()=>{const xml=await(await handler(false,path)(request(''))).text();assert.match(xml,/destination phone number/);assert.doesNotMatch(xml,/<Dial/)} )
}
