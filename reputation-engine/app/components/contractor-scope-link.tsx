'use client'
import { useEffect, useRef, useState } from 'react'
import type { Subcontractor } from '@/lib/subcontractors'
import { priceLabel, pricingStatusLabels, type ScopePricing } from '@/lib/contractor-scope-pricing'
type Review = { id: string; contractorId: string; contactName: string; url: string; expiresAt: string; revoked: boolean; pricing: ScopePricing }
function PricingControls({ review, leadId, reload }: { review: Review; leadId: string; reload: () => Promise<void> }) {
  const [amount, setAmount] = useState(''), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const retry = useRef<{ key: string; id: string } | null>(null)
  const p = review.pricing, closed = review.revoked || Date.parse(review.expiresAt) <= Date.now()
  async function act(action: string) {
    setBusy(true); setError('')
    const payload = { leadId, contractorId: review.contractorId, reviewId: review.id, action, revision: p.revision, amount: Number(amount), notes }
    const key = JSON.stringify(payload)
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }
    try {
      const r = await fetch('/api/sales/subcontractors/scope-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: retry.current.id }) })
      const data = await r.json(); if (!r.ok) throw Error(data.error)
      retry.current = null; await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return <article className="mt-4 rounded-xl border p-4">
    <h3 className="font-bold">{review.contactName}</h3><p className="mt-1 text-sm font-semibold">{closed ? 'Review closed or expired' : pricingStatusLabels[p.status]}</p>
    <a href={review.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-blue-700 underline">Open contractor review link</a>
    {p.offer && <p className="mt-3 text-sm">Your offer: <strong>{priceLabel(p.offer)}</strong>{p.offer.notes && <span className="mt-1 block whitespace-pre-wrap">{p.offer.notes}</span>}</p>}
    {p.response && <p className="mt-3 text-sm">Contractor price: <strong>{priceLabel(p.response)}</strong>{p.response.notes && <span className="mt-1 block whitespace-pre-wrap">{p.response.notes}</span>}</p>}
    {p.agreed && <p className="mt-3 text-sm font-bold text-green-800">Agreed: {priceLabel(p.agreed)}. Assignment and dispatch clearance are still required.</p>}
    {!closed && <div className="mt-4 space-y-3">
      {['submitted', 'countered'].includes(p.status) && <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => act('accept_price')} className="rounded-lg bg-green-800 px-3 py-2 text-sm text-white">Accept contractor price</button><button disabled={busy} onClick={() => act('decline')} className="rounded-lg border px-3 py-2 text-sm">Decline proposal</button></div>}
      <div className="grid gap-3"><label className="text-sm">Your flat-price offer (CAD)<input type="number" min="0.01" max="100000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></div>
      <label className="block text-sm">Offer terms / note visible to contractor<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full rounded-lg border p-2" /></label>
      <div className="flex flex-wrap gap-2"><button onClick={() => act('offer')} disabled={busy || !amount} className="rounded-lg bg-[#071421] px-3 py-2 text-sm text-white disabled:opacity-40">Set / counter with this offer</button><button onClick={() => act('request_price')} disabled={busy} className="rounded-lg border px-3 py-2 text-sm">Request contractor’s price</button></div>
      <p className="text-xs text-slate-500">Updates appear on the same link. A new offer or price request reopens negotiation and replaces the current agreement. No SMS or email is sent automatically.</p>
    </div>}
    {!!p.events.length && <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Response history ({p.events.length})</summary><ol className="mt-2 space-y-3">{[...p.events].reverse().map(e => <li key={e.id} className="border-t pt-2"><p>{e.actor === 'staff' ? 'Saturn' : review.contactName} · {e.action.replace(/_/g, ' ')} · {new Date(e.at).toLocaleString()}</p>{e.price && <p className="font-semibold">{priceLabel(e.price)}</p>}{e.notes && <p className="whitespace-pre-wrap">{e.notes}</p>}</li>)}</ol></details>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </article>
}
export default function ContractorScopeLink({ leadId, contractors }: { leadId: string; contractors: Subcontractor[] }) {
  const [id, setId] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reviews, setReviews] = useState<Review[]>([])
  async function load() {
    const r = await fetch(`/api/sales/subcontractors/scope-reviews?leadId=${encodeURIComponent(leadId)}`, { cache: 'no-store' }); const data = await r.json()
    if (!r.ok) throw Error(data.error); setReviews(data.reviews)
  }
  useEffect(() => { load().catch(e => setError(e.message)) }, [leadId])
  async function prepare() {
    setBusy(true); setError(''); setUrl('')
    try { const r = await fetch('/api/sales/subcontractors/scope-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', leadId, contractorId: id }) }); const data = await r.json(); if (!r.ok) throw Error(data.error); setUrl(data.url); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not create link') } finally { setBusy(false) }
  }
  return <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Contractor scope and price responses</h2><p className="mt-2 text-sm text-slate-600">Share a private inventory and access brief. Ask for a flat price, set your offer, or review a counteroffer here. Price agreements do not award the job; crew and insurance checks still apply.</p><div className="mt-3 flex flex-wrap gap-3"><select aria-label="Contractor for scope review" value={id} onChange={e => { setId(e.target.value); setUrl('') }} className="min-w-0 rounded-lg border p-2"><option value="">Choose a contractor</option>{contractors.filter(c => c.status !== 'blocked').map(c => <option key={c.id} value={c.id}>{c.companyName} — {c.contactName}</option>)}</select><button disabled={!id || busy} onClick={prepare} className="rounded-lg bg-[#071421] px-4 py-2 text-white disabled:opacity-40">{busy ? 'Preparing…' : 'Create / open review link'}</button><button onClick={() => load().catch(e => setError(e.message))} className="rounded-lg border px-3 py-2">Refresh responses</button></div>{url && <div className="mt-3"><a href={url} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-700 underline">{url}</a><p className="mt-1 text-xs text-slate-500">Copy this private link for the contractor. No message was sent.</p></div>}{reviews.map(review => <PricingControls key={review.id} review={review} leadId={leadId} reload={load} />)}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</section>
}
