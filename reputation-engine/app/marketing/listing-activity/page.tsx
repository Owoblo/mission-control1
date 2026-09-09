'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Listing = { activity_key:string; property_key:string; address:string; city:string; lane:string; listing_status:string; status_evidence:string; observed_at:string; source_url:string|null; postcard_status:string|null; match_status:string; representative:{role?:string;provenance?:string} }
type Contact = {id:string;name:string;company?:string;phone?:string;email?:string;stage?:string;last_touch_at?:string;do_not_contact?:boolean;listing_discovery_key?:string}
type Group = {key:string;representative:{name:string;brokerage?:string;phone?:string;email?:string};contact:Contact|null;listings:Listing[]}
const sourceLink=(value:string|null)=> value && /^https?:\/\//i.test(value) ? value : undefined
export default function ListingActivityPage() {
 const [groups,setGroups]=useState<Group[]>([]),[query,setQuery]=useState(''),[lane,setLane]=useState(''),[filter,setFilter]=useState(''),[active,setActive]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
 const [research,setResearch]=useState<Record<string,Record<string,number>>>({})
 const [matches,setMatches]=useState<Contact[]>([]),[matchQuery,setMatchQuery]=useState('')
 async function load(){setLoading(true);try{const r=await fetch('/api/marketing/listing-activity');const d=await r.json();if(!r.ok)throw new Error(d.error || 'Unable to load listing activity.');setGroups(d.groups);setResearch(d.research||{});setError('')}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
 useEffect(()=>{void load()},[])
 const visible=useMemo(()=>groups.filter(g=>(!lane||g.listings.some(l=>l.lane===lane))&&(!query||`${g.representative.name} ${g.representative.brokerage||''} ${g.listings.map(l=>`${l.address} ${l.city}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()))&&(filter!=='new'||!g.contact?.last_touch_at)&&(filter!=='missing_phone'||!(g.contact?.phone||g.representative.phone))&&(filter!=='review'||g.listings.some(l=>['new','ambiguous'].includes(l.match_status)))),[groups,query,lane,filter])
 const selected=visible.find(g=>g.key===active)||visible[0]
 async function search(){setBusy(true);try{const r=await fetch(`/api/marketing/contacts?mode=directory&limit=20&q=${encodeURIComponent(matchQuery)}`);if(!r.ok)throw new Error('Contact search failed');const d=await r.json();setMatches(d.contacts||[])}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function link(listing:Listing,contact_id?:string){setBusy(true);try{const r=await fetch('/api/marketing/listing-activity',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({activity_key:listing.activity_key,contact_id,create_contact:!contact_id})});if(!r.ok)throw new Error((await r.json()).error);await load();setMatches([])}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <main className="mx-auto max-w-7xl p-4 sm:p-6">
  <Link href="/marketing/partners" className="text-sm underline">← Partnerships</Link>
  <h1 className="mt-4 text-2xl font-semibold">Listing activity</h1>
  <p className="mt-2 text-sm text-slate-600">People connected to observed residential, rental and commercial listings. Review their properties, then continue the relationship manually.</p>
  <p className="mt-2 text-xs text-slate-500">Counts reflect our latest observations, not a complete live market inventory. Sold signals marked inferred come from listing disappearance. Discovery sends no messages.</p>
  <div className="my-5 flex flex-wrap gap-3">
   <input aria-label="Search people or properties" placeholder="Search people, brokerage or address" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-60 rounded-lg border p-2"/>
   <select aria-label="Market type" value={lane} onChange={e=>setLane(e.target.value)} className="rounded-lg border p-2"><option value="">All markets</option><option value="residential">Residential</option><option value="rental">Rental</option><option value="commercial">Commercial</option></select>
   <select aria-label="Relationship filter" value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-lg border p-2"><option value="">All people</option><option value="new">No recorded outreach</option><option value="missing_phone">Missing phone</option><option value="review">Needs review</option></select>
   <Link href="/marketing/listing-activity/assessments" className="rounded-lg border p-2">Pipeline assessments</Link>
  </div>
  {Object.entries(research).filter(([key])=>!lane||key===lane).map(([key,counts])=><p key={key} className="mb-2 text-xs text-slate-600">{key} property research: {Object.entries(counts).map(([status,n])=>`${n} ${status.replaceAll('_',' ')}`).join(' · ')}</p>)}
  {error&&<div role="alert" className="mb-4 text-red-700">{error} <button className="underline" onClick={()=>void load()}>Retry</button></div>}
  {loading?<p>Loading activity…</p>:error?null:<div className="grid gap-5 lg:grid-cols-[340px_1fr]">
   <aside className="max-h-[420px] space-y-2 overflow-y-auto lg:max-h-[70vh]"><p className="text-sm text-slate-500">{visible.length} people</p>{visible.map(g=>{
    const unique=new Map(g.listings.map(l=>[`${l.lane}:${l.property_key}`,l]));const ls=[...unique.values()];const sold=ls.filter(l=>['sold','sold_archived'].includes(l.listing_status)).length; const justListed=ls.filter(l=>l.listing_status==='just_listed').length
    return <button key={g.key} onClick={()=>{setActive(g.key);setMatches([])}} className={`w-full rounded-xl border p-4 text-left ${selected?.key===g.key?'border-emerald-700 bg-emerald-50':'bg-white'}`}>
     <strong>{g.contact?.name||g.representative.name}</strong><p className="text-sm text-slate-600">{g.contact?.company||g.representative.brokerage||'Brokerage unknown'}</p>
     <p className="mt-2 text-sm">{ls.length} observed properties · {justListed} just-listed · {sold} sold signals</p><p className="text-xs">{g.contact?.do_not_contact?'Do not contact':g.contact?.last_touch_at?'Existing outreach history':g.contact?'No recorded outreach':'Unlinked discovery'}</p>
    </button>})}{!visible.length&&<p>No matching people yet.</p>}</aside>
   {selected&&<section className="rounded-xl border bg-white p-5">
    <h2 className="text-xl font-semibold">{selected.contact?.name||selected.representative.name}</h2>
    <p className="text-sm">{selected.contact?.phone||selected.representative.phone||'Phone not found'} · {selected.contact?.email||selected.representative.email||'Email not found'}</p>
    <p className="mt-2 text-sm">{selected.contact?.last_touch_at?`Last recorded outreach: ${new Date(selected.contact.last_touch_at).toLocaleDateString()}`:'No outreach recorded for this contact.'}</p>
    {selected.contact&&<Link className="mt-3 inline-block rounded-lg bg-emerald-800 px-4 py-2 text-white" href={`/marketing/partners?tab=phone&contact=${selected.contact.id}`}>Open partnership conversation</Link>}
    {selected.contact?.do_not_contact&&<p className="mt-2 font-semibold text-red-700">Do not contact — existing restriction retained.</p>}
    {!selected.contact&&<div className="my-4 rounded-lg bg-slate-50 p-3"><p className="text-sm">Review the sources below before linking or creating a contact.</p><div className="mt-2 flex gap-2"><input aria-label="Find existing CRM contact" value={matchQuery} onChange={e=>setMatchQuery(e.target.value)} placeholder="Search existing contacts" className="min-w-0 rounded border p-2"/><button disabled={busy||!matchQuery} onClick={search} className="rounded border p-2">Search</button></div>{matches.map(c=><button disabled={busy} className="block py-2 text-sm underline" key={c.id} onClick={()=>link(selected.listings[0],c.id)}>Link {c.name} · {c.company}</button>)}<button disabled={busy} onClick={()=>link(selected.listings[0])} className="mt-2 rounded border p-2 text-sm">Confirm source and create paused contact</button></div>}
    <div className="mt-5 space-y-3">{selected.listings.filter(l=>!lane||l.lane===lane).map(l=><article key={l.activity_key} className="rounded-lg border p-4"><h3 className="font-semibold">{l.address}, {l.city}</h3><p className="text-sm">{l.lane} · {l.status_evidence==='inferred_first_disappearance'?'No longer advertised — sale unconfirmed':l.listing_status.replaceAll('_',' ')} · {l.representative.role?.replaceAll('_',' ')||'Role unknown'}</p><p className="text-xs text-slate-600">Observed {new Date(l.observed_at).toLocaleDateString()} · {l.status_evidence.replaceAll('_',' ')} · Postcard: {l.postcard_status||'No print batch'}</p>{l.representative.provenance==='web_research_review'&&<p className="text-xs text-amber-800">Web research — verify property and listing date before outreach.</p>}{sourceLink(l.source_url)&&<a className="mt-2 inline-block text-sm underline" href={sourceLink(l.source_url)} target="_blank" rel="noreferrer">View source</a>}</article>)}</div>
   </section>}
  </div>}
 </main>
}
