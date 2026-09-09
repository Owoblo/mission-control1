const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function load(fetch){const code=ts.transpileModule(fs.readFileSync('app/api/marketing/listing-activity/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};vm.runInNewContext(code,{exports,URL,fetch,require:n=>({
 'next/server':{NextResponse:{json:(x,init)=>new Response(JSON.stringify(x),init)}},
 '@/lib/server/session':{getSessionUser:async()=>({role:'owner'})},
 '@/lib/server/runtime':{requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})},
 '@/lib/server/partnership-access':{partnershipRecordMatchesSession:()=>true,partnershipScopeFilter:()=>'',canSeeAllPartnershipMarkets:()=>true,isPartnershipManager:()=>false}
}[n])});return exports}
test('preserves several people per property and several properties per person',async()=>{
 const reps=[{activity_key:'1',property_key:'home1',contact_id:'a',representative_key:'a',representative:{name:'A'},lane:'residential'},{activity_key:'2',property_key:'home1',contact_id:'b',representative_key:'b',representative:{name:'B'},lane:'residential'},{activity_key:'3',property_key:'home2',contact_id:'a',representative_key:'a',representative:{name:'A'},lane:'commercial'}]
 const route=load(async url=>new Response(JSON.stringify(url.includes('partner_listing_activity')?reps:url.includes('market_contacts')?[{id:'a',name:'A'},{id:'b',name:'B'}]:[])))
 const r=await route.GET(new Request('https://crm.test/api'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.groups.length,2);assert.equal(d.groups.find(g=>g.key==='a').listings.length,2);assert.equal(d.observed_connections,3)
})
test('does not create a duplicate when a same-name CRM contact exists',async()=>{
 let creates=0
 const route=load(async(url,init={})=>{
  if(init.method==='POST')creates++
  return new Response(JSON.stringify(url.includes('partner_listing_activity')?[{representative:{name:'Existing Person'},representative_key:'rep',city:'Windsor'}]:url.includes('listing_discovery_key')?[]:[{id:'existing'}]))
 })
 const r=await route.PATCH(new Request('https://crm.test/api',{method:'PATCH',body:JSON.stringify({activity_key:'1',create_contact:true})}));assert.equal(r.status,409);assert.equal(creates,0)
})
