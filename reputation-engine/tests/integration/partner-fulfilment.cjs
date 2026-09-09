const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
function moduleFrom(file, imports, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}; vm.runInNewContext(compiled, { exports, require: name => name in imports ? imports[name] : require(name), ...globals }); return exports
}
const logic = moduleFrom('lib/partner-fulfilment.ts', {})
const draft = () => ({ kind:'partner_email_fulfilment', revision:0, status:'draft', to:'partner@example.com', subject:'Requested information', body:'Your card is attached.', brand:'ssm', region:'london', note:'', nextReview:'', attachments:[] })
test('blocks wrong-brand cards, missing attachments, placeholders and oversized PDFs', () => {
  assert.throws(() => logic.validateEmailTask({...draft(),region:'ottawa'},true), /brand/)
  assert.throws(() => logic.validateEmailTask({...draft(),region:''},true), /attachment/)
  assert.throws(() => logic.validateEmailTask({...draft(),body:'Hi [Name]'},true), /placeholder/)
  assert.throws(() => logic.validateEmailTask({...draft(),attachments:[{filename:'policy.pdf',content:'JVBERi0'+'A'.repeat(2800000)}]},true), /2 MB/)
  assert.doesNotThrow(() => logic.validateEmailTask(draft(),true))
})
function harness({allowed=true, optedOut=false, provider='ok'}={}) {
  let row={id:'11111111-1111-4111-8111-111111111111',related_id:'22222222-2222-4222-8222-222222222222',description:JSON.stringify(draft()),status:'open',updated_at:'2026-09-09T20:00:00.000Z'}; let sends=0
  const contact={id:row.related_id,name:'Partner',city:'London',do_not_contact:optedOut}
  const fetch=async (url,opts={})=>{
    if(url.includes('api.resend.com')) {sends++; if(provider==='timeout')throw Error('timeout'); return new Response(JSON.stringify({id:'email-1'}),{status:200})}
    if(url.includes('market_touches'))return new Response('[]')
    if(url.includes('market_contacts'))return new Response(JSON.stringify([contact]))
    if(opts.method==='PATCH') {
      const at=decodeURIComponent(url.match(/updated_at=eq\.([^&]+)/)[1]);const status=url.match(/status=eq\.([^&]+)/)?.[1]
      if(row.updated_at!==at||(status&&row.status!==status))return new Response('[]')
      row={...row,...JSON.parse(opts.body)};return new Response(JSON.stringify([row]))
    }
    return new Response(JSON.stringify([row]))
  }
  const route=moduleFrom('app/api/marketing/fulfilment/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>new Response(JSON.stringify(body),init)}},
    'node:fs/promises':{readFile:async()=>Buffer.from('%PDF-1.4 test')},
    '@/lib/server/request-session':{getRequestSessionUser:async()=>({name:'John'})},
    '@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}}),readEnv:key=>key==='RESEND_API_KEY'?'fake':''},
    '@/lib/server/partnership-access':{partnershipRecordMatchesSession:()=>allowed},
    '@/lib/server/partnership-sms':{isOptOutText:()=>false},
    '@/lib/partner-fulfilment':logic,
  },{fetch,AbortSignal,process,Buffer})
  const request=()=>new Request('https://crm.test/api',{method:'POST',body:JSON.stringify({id:row.id,revision:0,action:'send',draft:draft(),reviewed:true})})
  return {route,request,sends:()=>sends,row:()=>({...row,metadata:JSON.parse(row.description)})}
}
test('forbidden and opted-out contacts cannot send',async()=>{
  for(const options of [{allowed:false},{optedOut:true}]){const h=harness(options);const r=await h.route.POST(h.request());assert.ok(r.status>=400);assert.equal(h.sends(),0)}
})
test('concurrent clicks send once and persist provider receipt',async()=>{
 const h=harness();await Promise.all([h.route.POST(h.request()),h.route.POST(h.request())]);assert.equal(h.sends(),1);assert.equal(h.row().metadata.status,'sent');assert.equal(h.row().metadata.providerId,'email-1')
})
test('uncertain provider outcome stays locked and prevents retry',async()=>{
 const h=harness({provider:'timeout'});await h.route.POST(h.request());assert.equal(h.row().metadata.status,'sending');await h.route.POST(h.request());assert.equal(h.sends(),1)
})
