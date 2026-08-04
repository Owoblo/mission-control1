'use client'

import Image from 'next/image'
import { use, useEffect, useState } from 'react'

type Payload = {
  companyName: string
  contactName: string
  status: string
  offer: {
    status: string; moveDate?: string; originCity: string; destinationCity: string; distanceKm?: number
    hoursMin?: number; hoursMax?: number; suggestedTruck?: string; crewSize?: number
    inventory: Array<{ name: string; qty: number; room?: string }>
    access: { origin?: string; destination?: string; parking?: string }
    notes?: string; payout: number; currency: string; expiresAt?: string
  }
}

export default function SubcontractorOfferPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params)
  const [data, setData] = useState<Payload | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch(`/api/subcontractor/offers/${token}`, { cache: 'no-store' })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (ok) setData(body); else setMessage(body.error || 'Offer unavailable.') })
  }, [token])

  async function respond(action: 'accept' | 'decline' | 'discussion') {
    setBusy(true)
    const response = await fetch(`/api/subcontractor/offers/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note }),
    })
    const body = await response.json()
    setMessage(response.ok
      ? action === 'accept' ? 'Job accepted. Dispatch will contact you with the private job packet.' : action === 'discussion' ? 'Request received. Dispatch will call you.' : 'Declined. Thank you for responding.'
      : body.error || 'Could not save your response.')
    if (response.ok) setData(current => current ? { ...current, status: body.outcome } : current)
    setBusy(false)
  }

  if (!data) return <main className="min-h-screen bg-[#F7F4ED] p-6 text-sm text-slate-600">{message || 'Loading secure offer…'}</main>
  const offer = data.offer
  const closed = ['accepted', 'declined', 'discussion', 'not_awarded'].includes(data.status) || offer.status !== 'open'

  return <main className="min-h-screen bg-[#F7F4ED] px-4 py-8 text-[#071421]">
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="rounded-[24px] bg-[#071421] p-6 text-white shadow-xl">
        <Image src="/brand/saturn-star-horizontal-full-color.png" alt="Saturn Star Moving" width={220} height={60} className="h-auto w-52" />
        <div className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#C99700]">Private subcontractor opportunity</div>
        <h1 className="mt-2 text-2xl font-extrabold">{offer.originCity} → {offer.destinationCity}</h1>
        <p className="mt-1 text-sm text-white/65">{offer.moveDate ? new Date(`${offer.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Date to be confirmed'}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase text-slate-400">Your payout</div><div className="mt-1 text-2xl font-extrabold">${Number(offer.payout).toFixed(2)}</div><div className="text-xs text-slate-500">{offer.currency}</div></div>
        <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase text-slate-400">Time range</div><div className="mt-1 text-lg font-bold">{offer.hoursMin || '?'}–{offer.hoursMax || '?'} hours</div></div>
        <div className="rounded-2xl bg-white p-4 shadow-sm"><div className="text-[10px] font-bold uppercase text-slate-400">Crew / truck</div><div className="mt-1 text-lg font-bold">{offer.crewSize || '?'} crew</div><div className="text-xs text-slate-500">{offer.suggestedTruck || 'Confirm with dispatch'}</div></div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-bold">Job scope</h2>
        {offer.distanceKm ? <p className="mt-2 text-sm text-slate-600">Estimated route: {Math.round(offer.distanceKm)} km</p> : null}
        <div className="mt-4 max-h-80 divide-y overflow-auto rounded-xl border">
          {offer.inventory.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between px-3 py-2 text-sm"><span>{item.name}{item.room ? <span className="text-slate-400"> · {item.room}</span> : null}</span><strong>×{item.qty}</strong></div>)}
          {!offer.inventory.length ? <div className="p-3 text-sm text-slate-500">Inventory pending final confirmation.</div> : null}
        </div>
        {(offer.access.origin || offer.access.destination || offer.access.parking) ? <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          {offer.access.origin ? <div>Origin access: {offer.access.origin}</div> : null}
          {offer.access.destination ? <div>Destination access: {offer.access.destination}</div> : null}
          {offer.access.parking ? <div>Parking: {offer.access.parking}</div> : null}
        </div> : null}
        {offer.notes ? <p className="mt-3 text-sm text-slate-600">{offer.notes}</p> : null}
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Customer identity, exact addresses, and customer pricing are withheld until award. Accepting confirms availability for the displayed scope and payout, subject to the final private job packet.</div>
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note or amount you want to discuss" className="min-h-20 w-full rounded-xl border bg-white p-3 text-sm" />
      {message ? <div className="rounded-xl bg-white p-4 text-sm font-semibold">{message}</div> : null}
      {!closed ? <div className="grid gap-3 sm:grid-cols-3">
        <button disabled={busy} onClick={() => void respond('accept')} className="rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white">Accept job</button>
        <button disabled={busy} onClick={() => void respond('discussion')} className="rounded-xl bg-[#C99700] px-4 py-3 font-bold">Call to discuss</button>
        <button disabled={busy} onClick={() => void respond('decline')} className="rounded-xl border bg-white px-4 py-3 font-bold text-rose-700">Decline</button>
      </div> : null}
      <p className="pb-6 text-center text-xs text-slate-400">Saturn Star Moving · Secure subcontractor dispatch</p>
    </div>
  </main>
}
