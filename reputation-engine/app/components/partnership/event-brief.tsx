'use client';
import {useEffect,useState} from 'react';
import type {planPartnerEvents} from '@/lib/partner-event-plan';
type Brief=ReturnType<typeof planPartnerEvents>;
export function EventBrief({contactId}:{contactId:string}){
 const [brief,setBrief]=useState<Brief|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setBrief(null);setError('');fetch('/api/marketing/listing-activity/brief?contact='+encodeURIComponent(contactId),{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);setBrief(d)}).catch(e=>{if(e.name!=='AbortError')setError(e.message)});return()=>controller.abort()},[contactId]);
 return <section className="my-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="font-semibold">Relationship approach</h3><p className="text-xs text-slate-600">Internal planning only. Nothing here sends or queues a message.</p>{error?<p role="alert" className="mt-2 text-red-700">{error}</p>:!brief?<p className="mt-2 text-sm">Checking messages, calls, Sales ownership and commitments…</p>:<>
 <p className="mt-3 text-sm font-medium">{brief.segment.replaceAll('_',' ')} · {brief.owner}</p><p className="mt-2 text-sm">{brief.approach}</p>
 {brief.holds.length>0&&<div className="my-3 rounded bg-amber-50 p-3 text-sm"><strong>Before considering outreach</strong><ul className="ml-4 list-disc">{brief.holds.map(h=><li key={h}>{h}</li>)}</ul></div>}
 <p className="text-xs">Card history: {brief.cardEvidence.requested} reviewed requests fulfilled · {brief.cardEvidence.sent} media sends. Delivery must be checked separately.</p>
 <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Event ideas and checks ({brief.events.length})</summary><div className="mt-2 space-y-3">{brief.events.map(e=><article key={e.key} className="rounded bg-white p-3 text-sm"><strong>{e.address||e.kind.replaceAll('_',' ')} — {e.purpose}</strong><p className="text-xs text-slate-600">{e.requiresResearch?'Attribution/status research needed':'Source-backed association'} · {e.fresh?'Recently observed':'Older or undated observation'}</p><ul className="ml-4 mt-2 list-disc">{e.concepts.map(c=><li key={c}>{c}</li>)}</ul><p className="mt-2 text-xs">Check: {e.checks.join(' · ')}</p></article>)}</div></details>
 <details className="mt-3 text-sm"><summary>Writing guidance</summary><ul className="ml-4 list-disc">{brief.writingRules.map(r=><li key={r}>{r}</li>)}</ul></details>
 </>}</section>
}
