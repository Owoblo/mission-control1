'use client'
import { useEffect, useState } from 'react'
import { DOCUMENT_TYPES, onboardingProgress } from '@/lib/contractor-onboarding'

export default function ContractorOnboardingReview({ id }: { id: string }) {
  const [data, setData] = useState<any>(null), [message, setMessage] = useState(''), [link, setLink] = useState(''), [documentLink, setDocumentLink] = useState('')
  const [busy, setBusy] = useState(false), [verified, setVerified] = useState(false), [note, setNote] = useState('')
  const endpoint = `/api/sales/subcontractors/${id}/onboarding`
  async function load() { const r = await fetch(endpoint, { cache: 'no-store' }); const b = await r.json(); if (!r.ok) throw Error(b.error); setData(b) }
  useEffect(() => { load().catch(e => setMessage(e.message)) }, [id])
  async function action(payload: any) {
    setBusy(true); setMessage('')
    try { const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const b = await r.json(); if (!r.ok) throw Error(b.error)
      if (payload.action === 'invite') { setLink(b.url); setMessage('Link ready. Copy it into the contractor conversation after your introductory call. No message has been sent.') }
      if (payload.action === 'document') { setDocumentLink(b.url); setMessage('Document ready. Open it below within 60 seconds.') }
      if (payload.action === 'review') { setMessage('Moved to agreement & standards. Contractor dispatch approval is unchanged.'); setVerified(false) }
      await load()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }
  return <section className="mx-auto mb-5 max-w-7xl rounded-2xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Contractor onboarding</h2><p className="text-sm text-slate-500">{data?.invite ? onboardingProgress(data.invite.stage, !!data.invite.checklist?.application, data.documents) : 'Start with a short call, then share the company form.'}</p></div><button disabled={busy} onClick={() => action({ action: 'invite' })} className="rounded-lg bg-[#071421] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Create / renew form link</button></div>
    {data?.invite && <div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(DOCUMENT_TYPES).map(([kind,label]) => <div key={kind} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{label}</b><p className={data.documents.some((d:any) => d.kind === kind) ? 'text-emerald-700' : 'text-amber-800'}>{data.documents.some((d:any) => d.kind === kind) ? data.invite.checklist?.documentsReviewedAt ? 'Reviewed' : 'Received · awaiting review' : 'Pending · contractor can upload later'}</p></div>)}</div>}
    {message && <p role="status" className="mt-3 rounded-lg bg-sky-50 p-3 text-sm">{message}</p>}
    {documentLink && <a href={documentLink} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg border px-4 py-2 text-sm font-bold">Open private document</a>}
    {link && <div className="mt-3 flex gap-2"><input aria-label="Private onboarding link" readOnly value={link} className="min-w-0 flex-1 rounded-lg border p-2 text-sm" /><button className="rounded-lg border px-3 text-sm" onClick={() => navigator.clipboard.writeText(link).then(() => setMessage('Link copied.')).catch(() => setMessage('Select and copy the link manually.'))}>Copy</button><a href={link} target="_blank" rel="noreferrer" className="rounded-lg border p-2 text-sm">Preview</a></div>}
    {data?.invite && <details className="mt-4"><summary className="cursor-pointer text-sm font-bold">Review application & documents</summary><p className="mt-3 text-xs text-slate-500">Capabilities and rates below are contractor-reported. Verify specialty experience and operational limits before assigning work.</p><dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(data.invite.application || {}).filter(([,v]) => v !== '' && v !== false && !(Array.isArray(v) && !v.length)).map(([k,v]) => <div key={k} className="rounded-lg bg-slate-50 p-3 text-sm"><dt className="font-bold capitalize">{k.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{Array.isArray(v) ? v.join(', ') : String(v)}</dd></div>)}</dl><div className="mt-4 flex flex-wrap gap-2">{data.documents.map((d:any) => <button key={d.id} disabled={busy} onClick={() => action({ action: 'document', documentId: d.id })} className="rounded-lg border px-3 py-2 text-sm">View {DOCUMENT_TYPES[d.kind as keyof typeof DOCUMENT_TYPES] || d.kind}</button>)}</div>
    {data.invite.stage === 'verification' && <div className="mt-4 space-y-3 border-t pt-4"><label className="flex gap-2 text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />I reviewed registration, representative ID, insurance and the additional-insured evidence, including the correct entity, coverage and expiry.</label><textarea aria-label="Review notes" placeholder="Review notes, limitations and follow-up items" value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border p-3 text-sm" /><button disabled={busy || !verified || Object.keys(DOCUMENT_TYPES).some(kind => !data.documents.some((d:any) => d.kind === kind))} onClick={() => action({ action: 'review', verified, note })} className="rounded-lg bg-[#071421] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Move to agreement & standards</button></div>}</details>}
  </section>
}
