import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import ts from 'typescript'
function route(saved: boolean, sharedComplete = true) {
  const writes: any[] = []
  const modules: Record<string, any> = {
    'node:crypto': { createHash, randomUUID },
    '@/lib/partner-context': { latestPartnerMessage: () => ({direction:'inbound'}) },
    '@/lib/server/partner-context': { loadPartnerContext: async () => ({ complete:sharedComplete, ambiguousPhone:false, replyStatus:'needs_reply', responsibility:'John', jobs:[], events:[{id:'source1',at:'2026-10-20',source:'SMS',audience:'partner',direction:'inbound',text:'Can you help?',channel:'sms'}] }) },
    'next/server': { NextResponse: Response },
    '@/lib/server/session': { getSessionUser: async () => ({role:'owner',name:'John'}) },
    '@/lib/server/runtime': { requireSupabaseEnv: () => ({url:'https://db.test',headers:{}}) },
    '@/lib/server/partnership-access': { partnershipRecordMatchesSession: () => true },
    '@/lib/server/partnership-reply-assistant': { PARTNERSHIP_REPLY_POLICY_VERSION:'test-policy', suggestPartnershipReply:async () => ({draft_sms:'Draft only',modelUsed:'test-model'}) },
  }
  const exports: any = {}
  runInNewContext(ts.transpileModule(readFileSync('app/api/marketing/contacts/[id]/ai-reply/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {
    exports, require:(id:string) => { if (!(id in modules)) throw Error(id); return modules[id] },
    Response, AbortSignal, Date, JSON, encodeURIComponent,
    fetch:async (url:string, init:any) => {
      if (url.includes('market_contacts')) return Response.json([{id:'contact1'}])
      assert.match(url,/saturn_ai_decisions$/)
      writes.push(JSON.parse(init.body))
      return new Response(null,{status:saved?201:503})
    },
  })
  return {run:()=>exports.POST(new Request('https://app.test'),{params:Promise.resolve({id:'contact1'})}),writes}
}
test('Draft requires durable audit with actual model, policy and source references',async()=>{
  const x=route(true); const r=await x.run(); assert.equal(r.status,200)
  const data=await r.json(); assert.ok(data.decision_id)
  assert.equal(x.writes[0].model_version,'test-model')
  assert.equal(x.writes[0].policy_version,'test-policy')
  assert.equal(x.writes[0].input.sources[0].id,'source1')
  assert.equal(x.writes[0].input.contextHash.length,64)
})
test('Audit persistence failure withholds draft instead of reporting success',async()=>{
  const x=route(false); const r=await x.run(); assert.equal(r.status,503)
  assert.equal((await r.json()).suggestion,undefined)
})
test('Incomplete shared history prevents drafting and audit of invented context',async()=>{
  const x=route(true,false); const r=await x.run(); assert.equal(r.status,409); assert.equal(x.writes.length,0)
})
