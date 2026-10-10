import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { maybeCreateDestinationOpportunityLead } from '../../lib/server/sales-opportunities'
import { researchDestinationRealtor, processDestinationRealtorJobs } from '../../lib/server/destination-realtor-research'
import type { CRMLead } from '../../lib/types'

const migration = 'supabase/migrations/20261010000100_destination_realtor_research.sql'
test('atomic reconciliation prevents duplicate creation, stale writes and double claims; retries expired leases',async()=>{
  const db=new PGlite()
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table crm_leads(id text primary key,data jsonb,deleted boolean default false,updated_at timestamptz);")
    await db.exec(await fs.readFile(migration,'utf8'))
    const version='2026-10-10T10:00:00Z'
    await db.query('insert into crm_leads values ($1,$2,false,$3)',['source',{id:'source'},version])
    const opportunity={id:'opportunity',realtorResearch:{status:'pending'}}
    const args=['source',version,opportunity,null,'generated','22 ridge st|strathroy']
    const run=()=>db.query<{ok:boolean}>('select reconcile_destination_opportunity($1,$2,$3,$4,$5,$6) ok',args)
    assert.equal((await run()).rows[0].ok,true)
    assert.equal((await run()).rows[0].ok,false)
    assert.equal((await db.query('select * from destination_realtor_jobs')).rows.length,1)
    const claimed=await db.query<{attempts:number}>('select * from claim_destination_realtor_job()')
    assert.equal(claimed.rows[0].attempts,1)
    assert.equal((await db.query('select * from claim_destination_realtor_job()')).rows.length,0)
    await db.exec("update destination_realtor_jobs set claimed_at=now()-interval '11 minutes'")
    assert.equal((await db.query<{attempts:number}>('select * from claim_destination_realtor_job()')).rows[0].attempts,2)
    const record=(await db.query<{data:any}>('select data from crm_leads where id=$1',['source'])).rows[0].data
    assert.equal(record.destinationOpportunityLeadId,'opportunity')
  } finally {await db.close()}
})

test('Ridge Street lifecycle creates once, synchronizes dates, clears changed-property identity and never sends',async()=>{
  process.env.SUPABASE_URL='https://destination.test';process.env.SUPABASE_KEY='test-only'
  const original=global.fetch
  let clock=0
  const rows=new Map<string,{data:CRMLead;updated_at:string;deleted:boolean}>()
  const put=(data:CRMLead)=>{rows.set(data.id,{data:structuredClone(data),updated_at:new Date(Date.UTC(2030,0,1,0,0,clock++)).toISOString(),deleted:false})}
  const source={id:'source',name:'Test customer',leadKind:'customer',stage:'booked',destAddress:'22 Ridge Street',destCity:'Strathroy',moveDate:'2030-11-17',createdAt:'2030-01-01',inventory:[],callLogs:[]} as CRMLead
  put(source)
  let writes=0
  global.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.hostname,'destination.test','No external provider or outbound messages allowed')
    const table=url.pathname.split('/').at(-1)
    let result:unknown=[]
    if (table==='crm_leads') {
      const id=url.searchParams.get('id')?.replace(/^eq\./,'')
      result=id?(rows.has(id)?[rows.get(id)]:[]):[...rows.values()].filter(r=>r.data.sourceLeadId===source.id)
    } else if(table==='listings') result=[{zpid:'ridge',address:'22 Ridge St, Strathroy-Caradoc, ON',city:'Strathroy-Caradoc',listingAgentNames:[],status:'sold'}]
    else if(table==='reconcile_destination_opportunity') {
      writes++
      const body=JSON.parse(String(init?.body));assert.equal(body.source_version,rows.get(source.id)?.updated_at)
      if(body.opportunity)put(body.opportunity)
      put({...rows.get(source.id)!.data,destinationOpportunityLeadId:body.opportunity?.id,destinationOpportunityStatus:body.source_status,destinationOpportunityLastCheckedAt:new Date().toISOString()})
      result=true
    } else throw new Error(`Unexpected request ${url}`)
    return Response.json(result)
  }
  try {
    const saved=await maybeCreateDestinationOpportunityLead({...source,destAddress:undefined},source)
    const id=saved.destinationOpportunityLeadId!;assert.ok(id);assert.equal(rows.size,2)
    assert.equal(rows.get(id)?.data.supabaseListing?.zpid,'ridge')
    await maybeCreateDestinationOpportunityLead(saved,saved);assert.equal(writes,1)
    put({...saved,moveDate:'2030-11-18'})
    await maybeCreateDestinationOpportunityLead(saved,rows.get(source.id)!.data)
    assert.equal(rows.size,2);assert.equal(rows.get(id)?.data.moveDate,'2030-11-18')
    put({...rows.get(source.id)!.data,destAddress:'99 Other Street'})
    await maybeCreateDestinationOpportunityLead(saved,rows.get(source.id)!.data)
    assert.equal(rows.get(id)?.data.realtorResearch?.status,'stale')
    assert.equal(rows.get(id)?.data.supabaseListing,null)
    assert.equal(rows.get(id)?.data.realtorPhone,undefined)
  } finally {global.fetch=original}
})

test('research refuses city-only/wrong-property opportunities before calling search',async()=>{
  const original=global.fetch
  process.env.SUPABASE_URL='https://destination.test';process.env.SUPABASE_KEY='test-only'
  global.fetch=async(input)=>{
    assert.equal(new URL(String(input)).hostname,'destination.test')
    return Response.json([{data:{id:'bad',leadKind:'realtor_opportunity',opportunityCity:'Strathroy',supabaseListing:{zpid:'wrong',address:'33 Strathroy Cres',city:'Hamilton'}},updated_at:'2026-10-10T10:00:00Z'}])
  }
  try {await assert.rejects(researchDestinationRealtor('bad'),/exact destination/)} finally{global.fetch=original}
})

test('queue records failed searches for retry rather than silently abandoning them',async()=>{
  const original=global.fetch;const updates:any[]=[]
  process.env.SUPABASE_URL='https://destination.test';process.env.SUPABASE_KEY='test-only'
  global.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.hostname,'destination.test')
    if(url.pathname.endsWith('claim_destination_realtor_job'))return Response.json([{lead_id:'bad',property_key:'bad|strathroy',attempts:1,claimed_at:'2026-10-10T10:00:00Z'}])
    if(url.pathname.endsWith('crm_leads'))return Response.json([{data:{id:'bad',leadKind:'realtor_opportunity',realtorResearch:{version:2,status:'pending',propertyKey:'bad|strathroy'}},updated_at:'2026-10-10T10:00:00Z'}])
    updates.push(JSON.parse(String(init?.body)));return Response.json([])
  }
  try {assert.equal((await processDestinationRealtorJobs()).status,'retry');assert.equal(updates[0].state,'pending');assert.match(updates[0].last_error,/exact destination/)} finally{global.fetch=original}
})

test('outreach gate rejects automated introductions, stale destinations and unconfirmed identities',async()=>{
  const {assertDestinationRealtorSend}=await import('../../lib/server/destination-realtor-send-guard')
  const original=global.fetch
  process.env.SUPABASE_URL='https://destination.test';process.env.SUPABASE_KEY='test-only'
  let sourceAddress='22 Ridge Street'
  let status='verified'
  global.fetch=async(input)=>{
    const url=new URL(String(input));assert.equal(url.hostname,'destination.test')
    if(url.pathname.endsWith('market_contacts'))return Response.json([])
    const source=url.searchParams.get('id')==='eq.source'
    return Response.json([{id:source?'source':'opp',data:source?{id:'source',stage:'booked',destAddress:sourceAddress,destCity:'Strathroy',moveDate:'2030-11-17'}:
      {id:'opp',sourceLeadId:'source',leadKind:'realtor_opportunity',primaryContactRole:'realtor',realtorPhone:'+12269276886',realtorResearch:{status,propertyKey:'22 ridge st|strathroy'}}}])
  }
  try {
    await assert.rejects(assertDestinationRealtorSend('opp','automation','+12269276886','sms'),/automated outreach/)
    await assertDestinationRealtorSend('opp','human','+12269276886','sms')
    sourceAddress='99 Other Street'
    await assert.rejects(assertDestinationRealtorSend('opp','human','+12269276886','sms'),/no longer current/)
    status='review'
    await assert.rejects(assertDestinationRealtorSend('opp','human','+12269276886','sms'),/Confirm the listing agent/)
  } finally {global.fetch=original}
})
