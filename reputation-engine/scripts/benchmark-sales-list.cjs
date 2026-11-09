// Read-only benchmark. Prints aggregate metrics only; no customer records or credentials.
const fs=require('fs');const path=require('path');const {performance}=require('perf_hooks');
const root=process.cwd();
const load=require(root+'/tests/helpers/load-typescript.cjs')(root);
const {SALES_CARD_FIELDS:SALES_LIST_LEAD_FIELDS}=load(root+'/lib/server/sales-list-reader.ts');
const env=process.env;
if(!env.SUPABASE_URL||!env.SUPABASE_KEY)throw new Error('Provide authorized read credentials through SUPABASE_URL and SUPABASE_KEY');
const headers={apikey:env.SUPABASE_KEY,Authorization:`Bearer ${env.SUPABASE_KEY}`};
async function read(table,params){const started=performance.now();const r=await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(params)}`,{headers,signal:AbortSignal.timeout(15000)});const body=await r.text();if(!r.ok)throw new Error(`Read failed ${r.status}`);return {rows:JSON.parse(body),bytes:Buffer.byteLength(body),ms:Math.round(performance.now()-started)}}
(async()=>{
 const runtime={requireSupabaseEnv:()=>({url:env.SUPABASE_URL,headers})};
 const loader=require(root+'/tests/helpers/load-typescript.cjs')(root,{'./runtime':runtime,'@/lib/server/runtime':runtime});
 const {getSalesOverview}=loader(root+'/lib/server/sales-repository.ts');
 const {projectSalesList}=loader(root+'/lib/sales-list-projection.ts');
 const {getLeadGuidance}=loader(root+'/lib/lead-guidance.ts');
 const start=performance.now();const payload=await getSalesOverview();const readMs=Math.round(performance.now()-start);
 const shapeStart=performance.now();const compact=projectSalesList(payload);const projectionMs=performance.now()-shapeStart;
 const quotes=new Map(payload.quotes.map(x=>[x.id,x]));const slimQuotes=new Map(compact.quotes.map(x=>[x.id,x]));let mismatches=0;
 for(let i=0;i<payload.leads.length;i++){const before=getLeadGuidance(payload.leads[i],quotes.get(payload.leads[i].quoteId)||null,payload.followUps);const after=getLeadGuidance(compact.leads[i],slimQuotes.get(compact.leads[i].quoteId)||null,compact.followUps);if(JSON.stringify(before)!==JSON.stringify(after))mismatches++}
 const result={measuredAt:new Date().toISOString(),source:'one live authorized owner overview snapshot; response shaping locally, no hosted-route timing',leads:payload.leads.length,quotes:payload.quotes.length,fullBytes:Buffer.byteLength(JSON.stringify(payload)),compactBytes:Buffer.byteLength(JSON.stringify(compact)),repositoryReadMs:readMs,projectionMs:Math.round(projectionMs*100)/100,guidanceMismatches:mismatches};
 console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1});
