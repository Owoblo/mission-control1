export type CoverageCounts = Record<string, number>
export type CoveragePerson = {key:string;name:string;contact_id:string|null;identity:string;role:string;brokerage:string|null;counts:CoverageCounts;samples:{address:string;url:string}[]}
export type CoverageBrokerage = {key:string;name:string;counts:CoverageCounts;people:string[]}
export type CoveragePartition = {city:string;region:string;lane:string;kind:string;counts:CoverageCounts;people:CoveragePerson[];brokerages:CoverageBrokerage[];latest_observation:string|null}
export type CoverageReport = {version:1;generated_at:string;freshness_days:number;recent_days:number;scope:string;partitions:CoveragePartition[]}
function addCounts(a:CoverageCounts,b:CoverageCounts){for(const [k,n]of Object.entries(b))a[k]=(a[k]||0)+n}
export function summarizeCoverage(report:CoverageReport, filters:{city?:string;lane?:string;kind?:string}={}){
 const selected=report.partitions.filter(p=>(!filters.city||p.city===filters.city)&&(!filters.lane||p.lane===filters.lane)&&(!filters.kind||p.kind===filters.kind))
 const totals:CoverageCounts={},people=new Map<string,CoveragePerson>(),brokerages=new Map<string,CoverageBrokerage>()
 for(const p of selected){
  addCounts(totals,p.counts)
  for(const person of p.people){const prev=people.get(person.key);if(prev){addCounts(prev.counts,person.counts);prev.samples=[...prev.samples,...person.samples].slice(0,3)}else people.set(person.key,{...person,counts:{...person.counts},samples:[...person.samples]})}
  for(const broker of p.brokerages){const prev=brokerages.get(broker.key);if(prev){addCounts(prev.counts,broker.counts);prev.people=[...new Set([...prev.people,...broker.people])]}else brokerages.set(broker.key,{...broker,counts:{...broker.counts},people:[...broker.people]})}
 }
 const byMotion=(a:{counts:CoverageCounts},b:{counts:CoverageCounts})=>(b.counts.active||0)-(a.counts.active||0)||(b.counts.observed||0)-(a.counts.observed||0)
 const pct=(n:number)=>totals.observed?Math.round(n/totals.observed*1000)/10:null
 return {generated_at:report.generated_at,scope:report.scope,freshness_days:report.freshness_days,recent_days:report.recent_days,totals,
  coverage:{attributed_pct:pct(totals.attributed||0),linked_pct:pct(totals.linked||0),reached_pct:pct(totals.reached||0),inbound_pct:pct(totals.replied||0)},
  identity_counts:{linked: [...people.values()].filter(p=>p.contact_id).length,unverified:[...people.values()].filter(p=>!p.contact_id).length},
  facets:{cities:[...new Set(report.partitions.map(p=>p.city))].sort(),lanes:[...new Set(report.partitions.map(p=>p.lane))].sort(),kinds:[...new Set(report.partitions.map(p=>p.kind))].sort()},
  people:[...people.values()].sort(byMotion).slice(0,200),
  brokerages:[...brokerages.values()].sort(byMotion).slice(0,200).map(b=>({...b,people_count:b.people.length,observed_share_pct:pct(b.counts.observed||0)})),
  total_brokerages:brokerages.size,display_limit:200}
}
