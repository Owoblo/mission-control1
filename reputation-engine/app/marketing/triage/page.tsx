'use client'
import { useEffect, useState } from 'react'
type Action={key:string;contactId:string;contactName?:string;title:string;reason:string;owner?:string;dueAt?:string;overdue:boolean;taskId?:string;evidence:{source:string;id:string}[]}
type Report={coverage:{complete:boolean;contacts:number;touches:number};total:number;overdue:number;rows:Action[];generatedAt:string}
export default function RelationshipTriage(){
 const[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[offset,setOffset]=useState(0)
 async function load(start=offset){setBusy(true);setError('');try{const r=await fetch(`/api/marketing/relationship-triage?offset=${start}&limit=100`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error||'Unable to load triage');setReport(j);setOffset(start)}catch(e){setError(e instanceof Error?e.message:'Unable to load triage');setReport(null)}finally{setBusy(false)}}
 useEffect(()=>{void load(0)},[])
 async function assign(key:string){setBusy(true);setError('');try{const r=await fetch('/api/marketing/relationship-triage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:[key]})});const j=await r.json();if(!r.ok)throw Error(j.error||'Could not create review task');await load()}catch(e){setError(e instanceof Error?e.message:'Could not create review task')}finally{setBusy(false)}}
 return <main className="mx-auto max-w-6xl p-8"><h1 className="text-3xl font-semibold">Relationship triage</h1><p className="my-3 text-slate-600">Replies, promises, meeting outcomes and sales handoffs needing attention.</p>
 <button disabled={busy} onClick={()=>void load(0)} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{busy?'Reviewing…':'Refresh all conversations'}</button>
 {error&&<p role="alert" className="my-4 text-red-700">{error}</p>}
 {report&&<><p className="my-4">{report.coverage.contacts.toLocaleString()} contacts reviewed · {report.total.toLocaleString()} actions · {report.overdue.toLocaleString()} overdue</p><p className="text-sm text-slate-500">Reviewed {new Date(report.generatedAt).toLocaleString()}. Creating a review task does not send a message.</p>
 <div className="my-6 space-y-3">{report.rows.map(a=><article key={a.key} className="rounded border p-4"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{a.contactName}: {a.title}{a.overdue?' — overdue':''}</h2><a className="underline" href={`/marketing/partners?tab=phone&contact=${encodeURIComponent(a.contactId)}`}>Open conversation</a></div><p className="my-2">{a.reason}</p><p className="text-sm">Owner: {a.owner||'Needs assignment'} · {a.dueAt?`Due: ${new Date(a.dueAt).toLocaleString()}`:'Due date needs review'}</p>{a.taskId?<a className="mt-3 inline-block underline" href="/tasks">View existing task</a>:<button disabled={busy} onClick={()=>void assign(a.key)} className="mt-3 rounded border px-3 py-2 disabled:opacity-50">Create review task</button>}</article>)}</div>
 {!report.rows.length&&<p>No open triage actions found. This does not establish that every historical message is classified.</p>}
 <div className="flex gap-4"><button disabled={busy||offset===0} onClick={()=>void load(Math.max(0,offset-100))}>Previous</button><button disabled={busy||offset+100>=report.total} onClick={()=>void load(offset+100)}>Next</button></div></>}
 </main>
}
