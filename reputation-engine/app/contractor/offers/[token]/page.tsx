'use client'

import { use, useEffect, useState } from 'react'

type Payload = { offer: { status: string; moveDate?: string; arrivalWindow?: string; originCity: string; destinationCity: string; estimatedHoursMin?: number; estimatedHoursMax?: number; suggestedTruck?: string; crewSize?: number; requiredServiceTags: string[]; accessSummary: Record<string, string>; scopeNotes?: string; sanitizedBriefing?: string; offeredPayout: number; currency: string; expiresAt?: string }; recipient: { status: string; companyName?: string; contactName?: string } }

export default function ContractorOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [data, setData] = useState<Payload | null>(null)
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`/api/contractor/offers/${token}`, { cache: 'no-store' }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body) }).catch(error => setMessage(error.message)) }, [token])
  async function respond(action: 'accept' | 'decline' | 'discussion') {
    setBusy(true); setMessage('')
    const response = await fetch(`/api/contractor/offers/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note }) })
    const body = await response.json(); setMessage(body.message || body.error || 'Response recorded.'); setBusy(false)
  }
  if (!data) return <main className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">{message || 'Loading job offer…'}</main>
  const closed = data.offer.status !== 'open' || ['accepted', 'declined', 'not_awarded'].includes(data.recipient.status)
  return <main className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-xl space-y-4">
    <section className="rounded-2xl bg-[#071421] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#C99700]">Saturn Star Contractor Offer</p><h1 className="mt-3 text-2xl font-bold">{data.offer.moveDate || 'Date TBD'}</h1><p className="mt-1 text-sm text-white/70">{data.recipient.companyName}</p></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold text-[#071421]">Job summary</h2><div className="mt-3 space-y-2 text-sm text-slate-600"><p>{data.offer.originCity} → {data.offer.destinationCity}</p><p>{data.offer.arrivalWindow || 'Arrival window TBD'} · {data.offer.estimatedHoursMin || '?'}–{data.offer.estimatedHoursMax || '?'} hours</p><p>{data.offer.crewSize || '?'} crew · {data.offer.suggestedTruck || 'Truck TBD'}</p>{data.offer.scopeNotes && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{data.offer.scopeNotes}</p>}</div></section>
    {data.offer.sanitizedBriefing && <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold text-[#071421]">Sanitized crew briefing</h2><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-600">{data.offer.sanitizedBriefing}</pre></section>}
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Offered payout</p><p className="mt-1 text-3xl font-bold text-emerald-900">{data.offer.currency} ${data.offer.offeredPayout.toFixed(2)}</p>{data.offer.expiresAt && <p className="mt-2 text-xs text-emerald-700">Respond by {new Date(data.offer.expiresAt).toLocaleString()}</p>}</section>
    {message && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{message}</div>}
    {!closed && <><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Optional note or question" className="min-h-24 w-full rounded-xl border border-slate-300 p-3 text-sm"/><div className="grid gap-3 sm:grid-cols-3"><button disabled={busy} onClick={() => respond('accept')} className="rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white">Accept</button><button disabled={busy} onClick={() => respond('discussion')} className="rounded-xl bg-[#071421] px-4 py-3 font-bold text-white">Ask a question</button><button disabled={busy} onClick={() => respond('decline')} className="rounded-xl border border-rose-200 bg-white px-4 py-3 font-bold text-rose-700">Decline</button></div></>}
  </div></main>
}
