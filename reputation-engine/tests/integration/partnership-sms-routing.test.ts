import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isAutomatedLeasingNotice, needsPartnershipRoutingReview } from '../../lib/server/partnership-routing-review'
function load(options: {sales?:boolean; matched?:boolean; lookupError?:boolean; authorized?:boolean} = {}) {
  const calls:string[]=[]
  const modules:Record<string,unknown>={
    '@/lib/server/interactions':{captureTwilioInteraction:async()=>{calls.push('raw-interaction')}},
    '@/lib/server/partnership-routing-review':{isAutomatedLeasingNotice,needsPartnershipRoutingReview,savePartnershipRoutingReview:async()=>{calls.push('review');return true}},
    '@/lib/server/sales-automation':{processInboundAutomationEvent:async()=>{calls.push('sales');return {lead:{id:'real-sale'}}}},
    '@/lib/sales-phones':{DEFAULT_SATURN_BRANCH_NUMBER:'+12268870667',getSaturnTrackingSource:()=> 'partnership_outreach',getSaturnTrackingLabel:()=> 'Windsor'},
    '@/lib/server/partnership-message-context':{getSalesSmsReplyLeadId:async()=>options.sales?'real-sale':null},
    '@/lib/server/partnership-inbound':{notifyPartnershipCustomerContact:async()=>{},pausePartnershipSequenceForInbound:async()=>{if(options.lookupError)throw Error('lookup failed');return {matched:!!options.matched}}},
    '@/lib/server/sales-repository':{getInboundLeadByPhone:async()=>null,saveInboundLead:async()=>{calls.push('inbound-lead')}},
    '@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}}),getWorkerSharedSecret:()=> 'secret',readEnv:()=>'',getAppBaseUrl:()=> 'https://app.test'},
    '@/lib/server/twilio-recordings':{twilioAuth:()=>null},
    '@/lib/server/analytics':{logEvent:async()=>{}},
    '@/lib/server/internal-notifications':{sendRepAlertEmail:async()=>{calls.push('notice')},smsNotificationEmail:()=>''},
    '@/lib/server/lead-media':{persistInboundMmsToLead:async()=>{}},
    '@/lib/server/security':{verifyTwilioSignature:async()=>options.authorized!==false},
  }
  const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync('app/api/sales/twilio/sms/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    exports, require:(id:string)=>{if(!(id in modules))throw Error(id);return modules[id]}, Response,URL,URLSearchParams,crypto,console:{error:()=>{}},
    fetch:async(url:string,init:any)=>{if(init?.method==='POST'&&url.includes('sms_messages'))calls.push('sms-history');return Response.json([])},
  })
  return {calls, post:exports.POST as (r:Request)=>Promise<Response>}
}
function request(body:string,to='+12268870667') {return new Request('https://app.test/api/sales/twilio/sms',{method:'POST',body:new URLSearchParams({From:'+15489185418',To:to,Body:body,MessageSid:'SMtest'})})}
test('reported leasing response persists history and review with zero Sales execution',async()=>{
  const {calls,post}=load();assert.equal((await post(request('Hi from Chatham Tower Apartments! Reply Y for touring assistance or to chat with us. EliseAI'))).status,200)
  assert.deepEqual(calls,['raw-interaction','sms-history','review','notice'])
})
test('unmatched partnership reply is retained without creating customer',async()=>{
  const {calls,post}=load();await post(request('Thanks, email our manager.'));assert.ok(calls.includes('review'));assert.ok(!calls.includes('sales'));assert.ok(!calls.includes('inbound-lead'))
})
test('failed relationship lookup never falls through to Sales',async()=>{
  const {calls,post}=load({lookupError:true});assert.equal((await post(request('Thanks'))).status,503);assert.deepEqual(calls,['raw-interaction'])
})
test('matched partnership reply remains on existing path',async()=>{
  const {calls,post}=load({matched:true});assert.equal((await post(request('Thanks'))).status,200);assert.deepEqual(calls,['raw-interaction'])
})
test('authenticated genuine sales reply keeps customer execution',async()=>{
  const {calls,post}=load({sales:true});assert.equal((await post(request('The move is Tuesday'))).status,200);assert.ok(calls.includes('sales'));assert.ok(!calls.includes('review'))
})

test('unauthenticated requests do not enter the interaction ledger', async () => {
  const {calls,post}=load({authorized:false});assert.equal((await post(request('hello'))).status,403);assert.deepEqual(calls,[])
})
