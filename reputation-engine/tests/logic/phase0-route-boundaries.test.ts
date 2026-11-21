import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as portalPolicy from '../../lib/partner-portal-policy'
function load(path: string, mocks: Record<string, unknown>, fetcher: typeof fetch = async () => { throw new Error('Unexpected network') }) {
  const exports: any = {}
  class NextResponse extends Response {
    static next() { return new Response(null, {status:204}) }
    static json(value: unknown, init?: ResponseInit) { return Response.json(value, init) }
  }
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
    {exports,require:(name:string)=>name==='next/server'?{NextResponse}:mocks[name] || {},Request,Response,URL,URLSearchParams,console,fetch:fetcher})
  return exports
}
const runtime = {'@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.example.test',headers:{}})}}
test('Unsubscribe middleware allows recipients without a staff session',async()=>{
  const middleware=load('middleware.ts',{'@/lib/server/cron-auth':{isCronApiPath:()=>false},'@/lib/auth':{getSessionPayload:()=>null}}).middleware
  const r=await middleware({nextUrl:new URL('https://app.test/api/marketing/email-unsubscribe?token=test')})
  assert.equal(r.status,204)
})
test('Unsubscribe GET is scanner-safe, validates token and escapes HTML',async()=>{
  let writes=0
  const route=load('app/api/marketing/email-unsubscribe/route.ts',runtime,async(_u,init)=>{if(init?.method)writes++;return Response.json([{id:'c'}])})
  const r=await route.GET(new Request('https://app.test/api/marketing/email-unsubscribe?token=%22%3E%3Cscript%3E'))
  assert.equal(r.status,200);assert.equal(writes,0);assert.equal((await r.text()).includes('<script>'),false)
  assert.equal((await route.GET(new Request('https://app.test/api/marketing/email-unsubscribe'))).status,400)
})
test('Unsubscribe never reports success on a failed suppression write',async()=>{
  const route=load('app/api/marketing/email-unsubscribe/route.ts',runtime,async(_u,init)=>init?.method==='PATCH'?new Response(null,{status:500}):Response.json([{id:'c'}]))
  const r=await route.POST(new Request('https://app.test/api/marketing/email-unsubscribe?token=test',{method:'POST'}))
  assert.equal(r.status,503);assert.equal((await r.json()).ok,false)
})
test('Repeated one-click POSTs produce one audit touch and retain suppression',async()=>{
  let suppressed=false;let touches=0
  const route=load('app/api/marketing/email-unsubscribe/route.ts',runtime,async(url,init)=>{
    if(init?.method==='PATCH') {assert.match(String(url),/email_status\.neq\.unsubscribed/);const rows=suppressed?[]:[{id:'c'}];suppressed=true;return Response.json(rows)}
    if(init?.method==='POST'){touches++;return new Response(null,{status:204})}
    return Response.json([{id:'c'}])
  })
  for(let i=0;i<2;i++)assert.equal((await route.POST(new Request('https://app.test/api/marketing/email-unsubscribe?token=test',{method:'POST',body:'List-Unsubscribe=One-Click'}))).status,200)
  assert.equal(touches,1)
})
test('Partner write checks crew membership and blocks arbitrary column updates before PATCH',async()=>{
  let writes=0
  const service=load('lib/server/partner-platform.ts',{
    ...runtime,'@/lib/partner-portal-policy':portalPolicy,
  },async(_url,init)=>{if(init?.method){writes++;throw new Error('Unexpected write')}return Response.json([{id:'a',subcontractor_id:'p',member_ids:['someone-else'],status:'assigned',updated_at:'2026-09-16'}])})
  const actor={portalRole:'partner_crew',partnerMemberId:'me'}
  await assert.rejects(service.updatePartnerResource('p','assignment','a',{status:'confirmed'},actor),/Assignment not permitted/)
  await assert.rejects(service.updatePartnerResource('p','assignment','a',{subcontractor_id:'other'},{portalRole:'partner_admin'}),/Field not permitted/)
  assert.equal(writes,0)
})
test('Claims must refer to a job assigned to this partner/crew',async()=>{
  let writes=0
  const service=load('lib/server/partner-platform.ts',{...runtime,'@/lib/partner-portal-policy':portalPolicy},async(_url,init)=>{
    if(init?.method){writes++;throw new Error('Unexpected write')}return Response.json([])
  })
  await assert.rejects(service.createPartnerResource('p','claim',{lead_id:'other-job',title:'Report'},{portalRole:'partner_crew',partnerMemberId:'me'}),/Assigned job required/)
  assert.equal(writes,0)
})

test('Non-callback dialer routes no longer bypass staff session middleware',async()=>{
  const middleware=load('middleware.ts',{'@/lib/server/cron-auth':{isCronApiPath:()=>false},'@/lib/auth':{getSessionPayload:()=>null,getSessionCookieName:()=> 'mc_session'}}).middleware
  const r=await middleware({nextUrl:new URL('https://app.test/api/sales/dialer/token'),headers:new Headers(),cookies:{get:()=>undefined},method:'GET'})
  assert.equal(r.status,401)
})

test('Review ID alone and partner sessions cannot read, patch, or upload customer records',async()=>{
  let mutations=0
  const route=load('app/api/public/reviews/[jobId]/route.ts',{
    '@/lib/server/session':{getSessionUser:async()=>({role:'partner_admin'})},
    '@/lib/server/review-capability':{verifyReviewCapability:()=>false},
    '@/lib/server/repository':{getJob:async()=>({id:'job'}),patchPublicReview:async()=>{mutations++}},
    '@/lib/server/lead-media':{uploadLeadMediaAssets:async()=>{mutations++}},
  })
  const props={params:Promise.resolve({jobId:'job'})}
  for(const method of ['GET','PATCH','POST']) {
    const r=await route[method](new Request('https://app.test/api/public/reviews/job',{method,...(method==='GET'?{}:{body:'invalid'})}),props)
    assert.equal(r.status,403)
  }
  assert.equal(mutations,0)
})

test('Partnership staff can reach their mobile send handler and voice token, without general sales access',async()=>{
 const middleware=load(process.env.SSM_MIDDLEWARE_TEST_SOURCE||'middleware.ts',{'@/lib/server/cron-auth':{isCronApiPath:()=>false},'@/lib/auth':{getSessionPayload:()=>({userId:'staff',role:'partnership_manager'}),getSessionCookieName:()=> 'mc_session'}}).middleware
 for(const [path,method,status] of [['/api/sales/send','POST',204],['/api/sales/dialer/token','GET',204],['/api/sales/leads','GET',403]]){
  const r=await middleware({nextUrl:new URL('https://app.test'+path),headers:new Headers({Authorization:'Bearer session'}),cookies:{get:()=>undefined},method})
  assert.equal(r.status,status,String(path))
 }
})
