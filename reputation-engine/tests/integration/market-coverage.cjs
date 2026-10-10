const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function moduleFrom(file,deps){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,URL,fetch:deps.fetch,require:n=>deps[n]});return exports;}
const summary=moduleFrom('lib/partner-market-coverage.ts',{});
function route(session,fetch){return moduleFrom('app/api/marketing/market-coverage/route.ts',{fetch,
 'next/server':{NextResponse:{json:(v,i)=>new Response(JSON.stringify(v),i)}},
 '@/lib/server/session':{getSessionUser:async()=>session},'@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})},
 '@/lib/server/partnership-access':{canSeeAllPartnershipMarkets:s=>s?.role==='owner',isPartnershipManager:s=>s?.role==='partnership_manager',partnershipRecordMatchesSession:(s,p)=>s.role==='owner'||p.city===s.branch},
 '@/lib/partner-market-coverage':summary});}
test('unauthorized request cannot read a snapshot',async()=>{let fetched=false;const r=await route(null,async()=>{fetched=true}).GET(new Request('https://crm.test/api'));assert.equal(r.status,401);assert.equal(fetched,false)});
test('scoped managers receive no other-market counts or filter options',async()=>{const partitions=['Toronto','Windsor'].map(city=>({city,lane:'residential',kind:'house',counts:{observed:1},people:[],brokerages:[]}));const r=await route({role:'partnership_manager',branch:'Windsor'},async()=>new Response(JSON.stringify([{report:{version:1,partitions}}]))).GET(new Request('https://crm.test/api'));const d=await r.json();assert.equal(d.totals.observed,1);assert.deepEqual(d.facets.cities,['Windsor'])});
test('failed source returns unavailable, never partial totals',async()=>{const r=await route({role:'owner'},async()=>new Response('{}',{status:500})).GET(new Request('https://crm.test/api'));assert.equal(r.status,503);assert(!('totals'in await r.json()))});
