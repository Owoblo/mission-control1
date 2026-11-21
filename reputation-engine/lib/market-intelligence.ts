import {type CoverageContact} from './relationship-coverage'
type Activity={activity_key:string;property_key:string;city:string;address:string;source_url:string;observed_at:string;contact_id:string|null;match_status:string;representative:Record<string,any>}
const norm=(v:unknown)=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'')
const number=(v:unknown)=>String(v||'').replace(/\D/g,'').slice(-10)
export function reviewOpenHouseIntelligence(rows:Activity[],contacts:CoverageContact[],at=new Date()){
 const byId=new Map(contacts.map(c=>[c.id,c]))
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(at)
 const work=rows.map(row=>{
  const rep=row.representative||{},events=Array.isArray(rep.open_house_events)?rep.open_house_events:[]
  const upcoming=events.filter((e:any)=>/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&e.date>=today)
  const ids=[...new Set([...(Array.isArray(rep.candidate_contact_ids)?rep.candidate_contact_ids:[]),...(row.contact_id?[row.contact_id]:[])])] as string[]
  const matches=ids.map(id=>byId.get(id)).filter((c):c is CoverageContact=>Boolean(c&&norm(c.name)===norm(rep.name)&&number(c.phone)&&number(c.phone)===number(rep.phone)))
  const flags:string[]=[]
  if(!upcoming.length)flags.push('schedule_expired_or_missing')
  const observed=Date.parse(row.observed_at)
  if(!Number.isFinite(observed)||observed>at.getTime()+300000||at.getTime()-observed>2*86400000)flags.push('source_recheck_due')
  if(rep.schedule_year_requires_confirmation)flags.push('calendar_year_confirmation')
  if(rep.host_role!=='verified')flags.push('host_role_unverified')
  if(matches.some(c=>c.do_not_contact||c.cross_channel_suppressed_at))flags.push('suppressed')
  if(matches.some(c=>{const t=Date.parse(c.last_touch_at||'');return Number.isFinite(t)&&at.getTime()-t<45*86400000}))flags.push('recent_contact')
  if(rep.identity_state==='phone_name_conflict'||(rep.conflicting_contact_ids||[]).length)flags.push('phone_name_conflict')
  if(rep.identity_state==='shared_route_review')flags.push('shared_route_review')
  if(matches.length!==1)flags.push(matches.length?'multiple_identity_candidates':'identity_unresolved')
  const state=flags.includes('suppressed')?'suppressed':flags.includes('schedule_expired_or_missing')?'expired':flags.includes('phone_name_conflict')||flags.includes('shared_route_review')||matches.length!==1?'identity_review':flags.includes('recent_contact')?'recent_contact_hold':'source_and_conversation_review'
  return {key:row.activity_key,property_key:row.property_key,city:row.city,address:row.address,name:String(rep.name||'Unknown representative'),source_url:row.source_url,observed_at:row.observed_at,upcoming_events:upcoming,state,flags,candidate_contact_ids:matches.map(c=>c.id),outreach_eligible:false,next_action:state==='suppressed'?'Keep suppressed; do not contact':state==='expired'?'Retain historical evidence; obtain a fresh signal':state==='identity_review'?'Resolve the named person and route using captured evidence first':state==='recent_contact_hold'?'Preserve recent contact; review the full conversation before any later action':'Confirm schedule/year and professional role, then review current conversation, preferences and commitments'}
 })
 return {evaluated_at:at.toISOString(),summary:{property_observations:new Set(rows.map(r=>r.property_key)).size,agent_associations:rows.length,identity_candidate_contacts:new Set(work.flatMap(w=>w.candidate_contact_ids)).size,expired:work.filter(w=>w.state==='expired').length,suppressed:work.filter(w=>w.state==='suppressed').length,identity_review:work.filter(w=>w.state==='identity_review').length,recent_contact_holds:work.filter(w=>w.state==='recent_contact_hold').length,automatically_eligible:0},work}
}

export function summarizeSourceFreshness(freshness:Record<string,any>|null,at=new Date()){
 return ['residential','rental','commercial'].map(lane=>{
  const source=freshness?.[lane],stamp=source?.latest_source_observed_at||null,parsed=Date.parse(stamp||'')
  const age=Number.isFinite(parsed)&&parsed<=at.getTime()?Math.floor((at.getTime()-parsed)/86400000):null
  return {lane,latest_source_observed_at:stamp,age_days:age,state:age===null?'unknown':age>=14?'stale':source?.older_than_14_days>0?'mixed_stale_inventory':'recent_observations',known_observation_dates:source?.known_observation_dates??null,older_than_14_days:source?.older_than_14_days??null,unknown_observation_dates:source?.unknown_observation_dates??null,note:'A recent observation does not certify a complete current feed or confirmed availability.'}
 })
}

type MovementSignal={id:string;region_key:string;title:string;canonical_url:string|null;published_at:string|null;last_seen_at:string|null;primary_category:string;movement_relevance:number;routing_status:string;sensitivity_flags?:string[];public_organization_names?:string[];responsible_organization?:string|null}
export function reviewMovementSignals(items:MovementSignal[],sources:Array<{id:string;source_name:string;region_key:string;last_success_at:string|null;last_error:string|null}>,contacts:CoverageContact[],at=new Date()){
 const companies=new Map<string,string[]>()
 for(const c of contacts){const key=norm(c.company);if(key)companies.set(key,[...(companies.get(key)||[]),c.id])}
 const work=items.map(item=>{
  const protectedEvent=item.routing_status==='retain_event_no_person_profiling'||Boolean(item.sensitivity_flags?.length)
  const published=Date.parse(item.published_at||'')
  const dateKnown=Number.isFinite(published)&&published<=at.getTime()+300000
  const stale=dateKnown&&at.getTime()-published>14*86400000
  const organizations=[...new Set([item.responsible_organization,...(item.public_organization_names||[])].filter(Boolean))] as string[]
  const matches=protectedEvent?[]:[...new Set(organizations.flatMap(o=>companies.get(norm(o))||[]))]
  const state=protectedEvent?'retain_event_no_person_profiling':!dateKnown?'publication_date_review':stale?'historical_context':!organizations.length?'organization_resolution':matches.length?'relationship_context_review':'organization_source_review'
  return {id:item.id,region:item.region_key,title:protectedEvent?'Public transition event — organization-level context only':item.title,category:item.primary_category,source_url:item.canonical_url,published_at:item.published_at,observed_at:item.last_seen_at,state,organizations:protectedEvent?[]:organizations,relationship_candidate_count:matches.length,candidate_contact_ids:matches.slice(0,20),outreach_eligible:false,next_action:state==='historical_context'?'Retain history; obtain current evidence before revival':state==='retain_event_no_person_profiling'?'Retain event and appropriate organizational context; no individual targeting':state==='organization_resolution'?'Identify the organization from supporting sources before investigating decision-makers':state==='publication_date_review'?'Confirm publication and event dates':'Review the original source, organizational role and existing conversation before choosing an action'}
 })
 const latest=(values:Array<string|null>)=>values.filter((v):v is string=>Boolean(v&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=at.getTime()+300000)).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null
 return {state:'connected',evaluated_at:at.toISOString(),summary:{signal_records:items.length,registered_sources:sources.length,latest_publication:latest(items.map(i=>i.published_at)),latest_source_seen:latest(items.map(i=>i.last_seen_at)),recent_publications:work.filter(w=>!['historical_context','publication_date_review'].includes(w.state)&&Date.parse(w.published_at||'')>=at.getTime()-14*86400000).length,historical_context:work.filter(w=>w.state==='historical_context').length,organization_resolution:work.filter(w=>w.state==='organization_resolution').length,protected_events:work.filter(w=>w.state==='retain_event_no_person_profiling').length,source_errors:sources.filter(s=>s.last_error).length,automatically_eligible:0},sources,work:work.sort((a,b)=>(Date.parse(b.published_at||'')||0)-(Date.parse(a.published_at||'')||0)),collection_activation:'Sold2Move controlled; this consumer reads saved evidence and does not start collection or paid research'}
}
