const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
function moduleFrom(file,imports,globals={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,URLSearchParams,require:n=>{if(!(n in imports))throw Error(n);return imports[n]},...globals});return exports}
const logic=moduleFrom('lib/acquisition-interview.ts',{})
function harness({session={role:'owner',name:'John'},allowed=true,conflict=false,missingConnector=false,saveFailure=false}={}){
 let writes=[];let row={id:'lead_1',updated_at:'2026-09-10T12:00:00Z',data:{id:'lead_1',name:'Test',source:'phone',stage:'booked',unrelated:'preserve me'}}
 const api=moduleFrom('app/api/sales/leads/[id]/acquisition/route.ts',{
  'next/server':{NextResponse:{json:(b,i)=>new Response(JSON.stringify(b),i)}},
  '@/lib/server/session':{getSessionUser:async()=>session},
  '@/lib/server/sales-permissions':{canAccessSalesWorkspace:s=>!!s&&['owner','manager','sales_rep'].includes(s.role),canEditLead:()=>allowed,leadMatchesSessionBranch:()=>allowed},
  '@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})},
  '@/lib/acquisition-interview':logic,
 },{fetch:async(url,options={})=>{
   if(options.method==='PATCH'){writes.push({url,body:JSON.parse(options.body)});if(saveFailure)return new Response('',{status:503});if(conflict)return new Response('[]');row={...row,...JSON.parse(options.body)};return new Response(JSON.stringify([row]))}
   if(url.includes('market_contacts'))return new Response(JSON.stringify(missingConnector?[]:[{id:'contact_1',name:'Verified connector',company:'Test company'}]))
   return new Response(JSON.stringify([row]))
 }})
 const draft={status:'answered',channel:'postcard',postcardRoute:'handed_by_connector',postcardLocation:'London',postcardCode:'CARD1',connectorId:'contact_1',connectorRole:'passed_card',customerWords:'From my realtor.'}
 return {api,writes,row:()=>row,put:async(revision=0)=>api.PUT(new Request('https://crm.test/api',{method:'PUT',body:JSON.stringify({interview:{...draft,recordedBy:'forged',connectorName:'forged'},expectedRevision:revision})}),{params:Promise.resolve({id:'lead_1'})})}
}
test('source save stamps actor, verifies connector, preserves source/stage, and uses conditional update',async()=>{
 const h=harness();const r=await h.put();assert.equal(r.status,200)
 const d=await r.json();assert.equal(d.interview.recordedBy,'John');assert.equal(d.interview.connectorName,'Verified connector')
 assert.equal(h.row().data.source,'phone');assert.equal(h.row().data.stage,'booked');assert.equal(h.row().data.unrelated,'preserve me')
 assert.ok(new URL(h.writes[0].url).searchParams.has('updated_at'));assert.equal(h.writes.length,1)
})
test('repeat stale edits cannot overwrite and accepted edits retain previous answers',async()=>{
 const h=harness();await h.put();assert.equal((await h.put()).status,409);assert.equal(h.writes.length,1)
 assert.equal((await h.put(1)).status,200);assert.equal(h.row().data.acquisitionInterviewHistory.length,1);assert.equal(h.row().data.acquisitionInterview.revision,2)
})
test('unauthorized or out-of-scope requests never save',async()=>{
 for(const options of [{session:null},{session:{role:'crew'}},{allowed:false}]){const h=harness(options);assert.ok((await h.put()).status>=400);assert.equal(h.writes.length,0)}
})
test('missing connector, concurrent update and backend failure return explicit errors',async()=>{
 for(const [options,status] of [[{missingConnector:true},400],[{conflict:true},409],[{saveFailure:true},502]]){const h=harness(options);assert.equal((await h.put()).status,status)}
})
