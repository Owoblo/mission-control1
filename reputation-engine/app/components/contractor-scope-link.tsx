'use client'
import { useState } from 'react'
import type { Subcontractor } from '@/lib/subcontractors'
export default function ContractorScopeLink({ leadId, contractors }: { leadId: string; contractors: Subcontractor[] }) {
  const [id, setId] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function prepare() {
    setBusy(true); setError(''); setUrl('')
    try { const r = await fetch('/api/sales/subcontractors/scope-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', leadId, contractorId: id }) }); const data = await r.json(); if (!r.ok) throw Error(data.error); setUrl(data.url) } catch (e) { setError(e instanceof Error ? e.message : 'Could not create link') } finally { setBusy(false) }
  }
  return <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Ask a contractor to review the scope</h2><p className="mt-2 text-sm text-slate-600">Create a private inventory and access brief before agreeing a price. This does not send a message or award the job. Pending contractors can review a scope; dispatch checks still apply.</p><div className="mt-3 flex flex-wrap gap-3"><select aria-label="Contractor for scope review" value={id} onChange={e => { setId(e.target.value); setUrl('') }} className="min-w-0 rounded-lg border p-2"><option value="">Choose a contractor</option>{contractors.filter(c => c.status !== 'blocked').map(c => <option key={c.id} value={c.id}>{c.companyName} — {c.contactName}</option>)}</select><button disabled={!id || busy} onClick={prepare} className="rounded-lg bg-[#071421] px-4 py-2 text-white disabled:opacity-40">{busy ? 'Preparing…' : 'Create review link'}</button></div>{url && <div className="mt-3"><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-700 underline">{url}</a><p className="mt-1 text-xs text-slate-500">Copy this link for the contractor. It expires after 14 days.</p></div>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</section>
}
