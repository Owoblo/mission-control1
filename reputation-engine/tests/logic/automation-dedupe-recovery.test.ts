import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
function repository(status: string, race=false) {
 const exports:any={};let posts=0;let gets=0
 const row={id:'existing',lead_id:'lead1',kind:'listing_inventory_scan',status,attempts:1,dedupe_key:'scan1',payload:{},result:{}}
 const modules:any={ '@/lib/server/partnership-message-context':{excludePartnershipMessages:(x:any)=>x},'@/lib/sales':{uid:()=> 'new'},'@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})}}
 runInNewContext(ts.transpileModule(readFileSync('lib/server/sales-automation-repository.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:(id:string)=>{if(!(id in modules))throw Error(id);return modules[id]},Date,JSON,encodeURIComponent,fetch:async(_url:string,init:any)=>{
  if(init?.method==='POST'){posts++;return Response.json({code:'23505',message:'duplicate dedupe_key'},{status:409})}
  gets++;return Response.json(race&&gets===1?[]:[row])
 }})
 return {run:()=>exports.queueAutomationJob({leadId:'lead1',kind:'listing_inventory_scan',dedupeKey:'scan1'}),posts:()=>posts}
}
test('Repeated intake does not resurrect failed or cancelled jobs',async()=>{
 for(const status of ['failed','cancelled','completed']){const r=repository(status);const job=await r.run();assert.equal(job.id,'existing');assert.equal(job.status,status);assert.equal(r.posts(),0)}
})
test('Concurrent duplicate reservation returns existing job without resetting it',async()=>{
 const r=repository('running',true);const job=await r.run();assert.equal(job.id,'existing');assert.equal(job.status,'running');assert.equal(r.posts(),1)
})
