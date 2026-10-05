const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
const root=process.cwd()
function load(current,currentLead=null){let saved=null;const noop=async()=>{};const stubs={
 'next/server':{NextResponse:{json:(x,init)=>new Response(JSON.stringify(x),init)}},
 '@/lib/server/session':{getSessionUser:async()=>({role:'owner',name:'Fixture Owner'})},
 '@/lib/server/sales-repository':{getSalesQuote:async()=>structuredClone(current),getSalesLead:async()=>structuredClone(currentLead),saveSalesQuote:async q=>(saved=structuredClone(q)),saveSalesLead:async l=>l},
 '@/lib/server/sales-audit':{getAcceptedQuoteLockedFieldChanges:()=>[],ACCEPTED_QUOTE_LOCKED_KEYS:[],recordQuoteUpdatedAudit:noop},
 '@/lib/server/sales-automation':{scheduleQuoteFollowup:noop,scheduleQuoteExpiryFollowup:noop,scheduleQuoteViewedFollowup:noop},
 '@/lib/server/internal-notifications':{sendRepAlertEmail:()=>{throw Error('Notification attempted')},quoteViewedEmail:()=>'',quoteAcceptedEmail:()=>''},
 '@/lib/server/analytics':{logEvent:noop},
 };const code=ts.transpileModule(fs.readFileSync('app/api/sales/quotes/[id]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(code,{exports,Request,Response,URL,console,structuredClone,require:n=>stubs[n]||(n.startsWith('@/lib/')?require(path.join(root,n.slice(2)+'.ts')):require(n))});return {patch:body=>exports.PATCH(new Request('https://fixture.invalid/api',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:current.id})}),saved:()=>saved}}

module.exports={load}
