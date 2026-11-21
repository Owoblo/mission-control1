import catalog from './coverage-catalog.json'

export type CoverageContact = {id:string;name?:string|null;company?:string|null;title?:string|null;city?:string|null;industry?:string|null;category?:string|null;phone?:string|null;email?:string|null;stage?:string|null;last_touch_at?:string|null;last_inbound_at?:string|null;do_not_contact?:boolean|null;cross_channel_suppressed_at?:string|null}
export const coverageCatalog = catalog
export const normalizeCoverage = (value:unknown) => String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const aliases = new Map<string,Set<string>>()
for(const city of catalog.municipalities) for(const name of [city.name,...city.aliases]) {
  const key=normalizeCoverage(name); const ids=aliases.get(key)||new Set<string>();ids.add(city.id);aliases.set(key,ids)
}
export function coverageCity(value:unknown){const ids=aliases.get(normalizeCoverage(value));return ids?.size===1?[...ids][0]:null}
export function coverageCategories(row:CoverageContact){
 const explicit=catalog.categories.find(c=>c.id===row.category)
 if(explicit)return [explicit.id]
 const text=' '+normalizeCoverage([row.category,row.industry,row.company,row.title].filter(Boolean).join(' '))+' '
 const matches=catalog.categories.filter(c=>c.terms.some(t=>text.includes(' '+normalizeCoverage(t)+' '))).map(c=>c.id)
 if(text.includes(' mortgage ')&&!matches.includes('category-22'))matches.push('category-22')
 if((text.includes(' real estate ')||text.includes(' realty ')||text.includes(' realtor '))&&!matches.includes('category-21'))matches.push('category-21')
 return matches.length?matches:['unclassified']
}
export function buildRelationshipCoverage(contacts:CoverageContact[],opportunities:Array<{contact_id?:string;stage?:string;next_action_due?:string;id?:string;name?:string;next_action?:string;assigned_manager_name?:string}>,receivedAt:string){
 const ids=new Set<string>(), rows=new Map<string,any>();let unresolved=0,suppressed=0
 const opByContact=new Map<string,typeof opportunities>()
 for(const o of opportunities){if(!o.contact_id)continue;opByContact.set(o.contact_id,[...(opByContact.get(o.contact_id)||[]),o])}
 for(const contact of contacts){
  if(ids.has(contact.id))continue;ids.add(contact.id)
  const geo=coverageCity(contact.city);if(!geo)unresolved++
  const isSuppressed=Boolean(contact.do_not_contact||contact.cross_channel_suppressed_at);if(isSuppressed)suppressed++
  for(const categoryId of coverageCategories(contact)){
   const cityId=geo||'unresolved:'+normalizeCoverage(contact.city||'Missing city'),key=cityId+'|'+categoryId
   let row=rows.get(key)
   if(!row){row={key,city_id:cityId,city:catalog.municipalities.find(c=>c.id===geo)?.name||String(contact.city||'Missing city')+' (unresolved)',category_id:categoryId,category:catalog.categories.find(c=>c.id===categoryId)?.name||'Unclassified',crm_records:0,with_phone:0,with_email:0,suppressed:0,with_recorded_touch:0,with_recorded_inbound:0,opportunities:0,market_total:null,coverage_percent:null};rows.set(key,row)}
   row.crm_records++;row.with_phone+=Boolean(contact.phone)?1:0;row.with_email+=Boolean(contact.email)?1:0;row.suppressed+=isSuppressed?1:0;row.with_recorded_touch+=contact.last_touch_at?1:0;row.with_recorded_inbound+=contact.last_inbound_at?1:0;row.opportunities+=(opByContact.get(contact.id)||[]).length
  }
 }
 // Empty catalog cells are visible as unverified coverage gaps, not omitted.
 for(const city of catalog.municipalities)for(const category of catalog.categories){const key=city.id+'|'+category.id;if(!rows.has(key))rows.set(key,{key,city_id:city.id,city:city.name,category_id:category.id,category:category.name,crm_records:0,with_phone:0,with_email:0,suppressed:0,with_recorded_touch:0,with_recorded_inbound:0,opportunities:0,market_total:null,coverage_percent:null})}
 return {received_at:receivedAt,summary:{crm_records:ids.size,unresolved_geographies:unresolved,suppressed,recorded_opportunities:opportunities.length,municipalities:catalog.municipalities.length,categories:catalog.categories.length},rows:[...rows.values()].sort((a,b)=>a.city.localeCompare(b.city)||a.category.localeCompare(b.category)),opportunities,
  definitions:{classification:'Provisional category matches from CRM category, industry, employer and title; overlaps are possible. Counts are CRM records, not verified unique people.',history:'Recorded touch/inbound timestamps are CRM fields, not an exhaustive message audit. A recorded touch is not confirmed delivery.',market_share:'Market total, unique verified people and revenue market share are unknown until reference populations and identity/outcome attribution are connected.'}}
}
