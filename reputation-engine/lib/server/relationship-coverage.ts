import {unstable_cache} from 'next/cache'
import {requireSupabaseEnv,readEnv} from './runtime'
import {buildRelationshipCoverage, type CoverageContact} from '../relationship-coverage'
import {reviewOpenHouseIntelligence,summarizeSourceFreshness,reviewMovementSignals} from '../market-intelligence'

const loadOpenHouseActivity=unstable_cache(async()=>{
 const {url,headers}=requireSupabaseEnv()
 const res=await fetch(`${url}/rest/v1/partner_listing_activity?${new URLSearchParams({select:'activity_key,property_key,city,address,source_url,observed_at,contact_id,match_status,representative',run_id:'eq.public-open-house-bridge-20261117',order:'activity_key.asc',limit:'1000'})}`,{headers:{...headers,Prefer:'count=exact'},cache:'no-store',signal:AbortSignal.timeout(18000)})
 if(!res.ok)throw Error('Open-house intelligence unavailable')
 const rows=await res.json(),count=Number(res.headers.get('content-range')?.split('/')[1])
 if(!Number.isSafeInteger(count)||count!==rows.length)throw Error('Open-house collection incomplete; no partial total shown')
 return rows
},['open-house-bridge-v1'],{revalidate:120})

const cachedPage=unstable_cache(async(table:string,select:string,offset:number,count:boolean,epoch:number)=>{
 const {url,headers}=requireSupabaseEnv()
  const res=await fetch(`${url}/rest/v1/${table}?${new URLSearchParams({select,order:'id.asc',limit:'1000',offset:String(offset)})}`,{headers:{...headers,...(count?{Prefer:'count=exact'}:{})},cache:'no-store',signal:AbortSignal.timeout(18000)})
  if(!res.ok)throw Error(`${table} unavailable (${res.status})`)
  const rows=await res.json()
  const range=res.headers.get('content-range')?.split('/')[1]
  return {rows,total:range&&range!=='*'?Number(range):null,received_at:new Date().toISOString()}
},['relationship-coverage-page-v2'],{revalidate:120})
async function collect<T>(table:string,select:string,max=75000):Promise<T[]>{
 const epoch=Math.floor(Date.now()/120000)
 const page=(offset:number,count=false)=>cachedPage(table,select,offset,count,epoch)
 const first=await page(0,true)
 if(first.total===null||!Number.isSafeInteger(first.total)||first.total>max)throw Error(`${table} count unavailable or report limit exceeded; no partial total displayed`)
 const rows:T[]=[...first.rows]
 for(let offset=1000;offset<first.total;offset+=4000){const pages=await Promise.all([0,1000,2000,3000].filter(n=>offset+n<first.total!).map(n=>page(offset+n)));for(const p of pages)rows.push(...p.rows)}
 if(rows.length!==first.total||new Set(rows.map(r=>(r as {id:string}).id)).size!==first.total)throw Error(`${table} changed during pagination; refresh to collect a consistent count`)
 return rows
}

export const loadCoverageContacts=()=>collect<CoverageContact>('market_contacts','id,name,company,title,city,industry,category,phone,email,stage,last_touch_at,last_inbound_at,do_not_contact,cross_channel_suppressed_at')

export const loadLiveCoverage=unstable_cache(async()=>{
 const startedAt=new Date().toISOString()
 const [contacts,opportunities,activities,movementRead]=await Promise.all([
  loadCoverageContacts(),
  collect<{id:string;contact_id:string;name:string;stage:string;next_action:string;next_action_due:string;assigned_manager_name:string}>('partner_opportunities','id,contact_id,name,stage,next_action,next_action_due,assigned_manager_name',10000),loadOpenHouseActivity(),
  Promise.all([collect<any>('movement_signal_items','id,region_key,title,canonical_url,published_at,primary_category,movement_relevance,routing_status,sensitivity_flags,public_organization_names,responsible_organization,last_seen_at',20000),collect<any>('movement_signal_sources','id,region_key,source_name,last_success_at,last_error',10000)]).catch(()=>null)])
 const movement=movementRead?reviewMovementSignals(movementRead[0],movementRead[1],contacts):{state:'unavailable',summary:{signal_records:null,registered_sources:null,recent_publications:null,latest_publication:null,latest_source_seen:null},work:[],collection_activation:'Sold2Move controlled; source read unavailable, counts unknown'}
 return {...buildRelationshipCoverage(contacts,opportunities,new Date().toISOString()),intelligence:reviewOpenHouseIntelligence(activities,contacts),movement,collection_started_at:startedAt,refresh_seconds:120}
},['relationship-coverage-v4'],{revalidate:120})

export async function loadResearchStatus(){
 const password=readEnv('COVERAGE_RESEARCH_PASSWORD')
 if(!password)return {state:'not_connected',checked_at:new Date().toISOString()}
 const headers={Authorization:'Basic '+Buffer.from('john:'+password).toString('base64')}
 const fetchStatus=async(path:string)=>{const r=await fetch('https://windsor-research-production.up.railway.app'+path,{headers,cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`Research status HTTP ${r.status}`);return r.json()}
 const results=await Promise.allSettled([fetchStatus('/status'),fetchStatus('/research/status')])
 const root=results[0].status==='fulfilled'?results[0].value:null
 const hub=results[1].status==='fulfilled'?results[1].value:null
 const lanes=hub?.lanes||{}
 const listingReport=lanes.listing_relationships?.report||{}
 const lastBatch=root?.campaign?.batches?.at(-1)
 const cost=lastBatch?.saved?{evidence_at:root.campaign.updated_at||null,last_saved_batch:lastBatch,token_estimate_per_saved_investigation_usd:lastBatch.estimated_saved_result_token_usd/lastBatch.saved,exclusions:'Saved-result token estimate excludes search/tool charges, unallocated retries, infrastructure and other unallocated costs; it is not the provider bill.'}:null
 return {state:root&&hub?'connected':'partial_or_unavailable',checked_at:new Date().toISOString(),
  source_freshness:summarizeSourceFreshness(listingReport.source_freshness||null),cost,
  coordinator_state:root?.state||null,campaign:root?.campaign||null,city_progress:root?.city_progress||null,
  extraction:root?.contact_enrichment||null,
  lanes:Object.entries(lanes).map(([name,value])=>{const lane=value as {report?:Record<string,unknown>};const r=lane.report||{};return {name,updated_at:r.updated_at||null,state:r.state||null,last_research_cycle:r.last_research_cycle||null,api_attempts:r.api_attempts??null,api_hold:r.api_hold||null,counts:r.counts||null,tasks:r.tasks||null,candidate_connections:r.candidate_connections??null,candidate_routes:r.candidate_routes??null}})}
}
