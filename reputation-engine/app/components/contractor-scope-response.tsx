'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { priceLabel, pricingStatusLabels, taxLabels, type ScopePricing, type TaxTreatment } from '@/lib/contractor-scope-pricing'
export default function ContractorScopeResponse({ token, initial }: { token: string; initial: ScopePricing }) {
  const router = useRouter()
  const [pricing, setPricing] = useState(initial), [amount, setAmount] = useState(''), [tax, setTax] = useState<TaxTreatment | ''>(''), [notes, setNotes] = useState(''), [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const retry = useRef<{ key: string; id: string } | null>(null)
  useEffect(() => { setPricing(initial); setConfirm(false) }, [initial])
  async function respond(action: string) {
    setBusy(true); setError(''); setMessage('')
    const payload = { action, revision: pricing.revision, amount: Number(amount), tax, notes, confirm }
    const key = JSON.stringify(payload)
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() }
    try {
      const response = await fetch(`/api/contractor/scope/${token}/response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: retry.current.id }) })
      const data = await response.json()
      if (!response.ok) throw Error(data.error || 'Could not save your response.')
      setPricing(data.pricing); setMessage('Your response has been saved for John to review.'); retry.current = null; setConfirm(false)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please try again.') } finally { setBusy(false) }
  }
  const latest = pricing.events.at(-1)
  const open = pricing.status === 'offered' || pricing.status === 'request_price'
  return <section id="price-response" className="rounded-2xl border-2 border-[#e6bd51] bg-white p-5">
    <h2 className="text-xl font-bold">Your price and availability</h2>
    <p className="mt-2 font-semibold">{pricingStatusLabels[pricing.status]}</p>
    <p className="mt-2 text-sm leading-6 text-slate-600">All prices are in Canadian dollars for the full scope above. A price agreement is subject to Saturn confirming the assignment and completing crew and insurance checks.</p>
    {latest?.actor === 'staff' && latest.notes && latest.action !== 'offer' && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">John’s note: {latest.notes}</p>}
    {pricing.offer && <div className="mt-4 rounded-xl bg-slate-100 p-4"><h3 className="text-sm font-bold">Saturn’s flat-price offer</h3><p className="mt-1 text-lg font-bold">{priceLabel(pricing.offer)}</p>{pricing.offer.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{pricing.offer.notes}</p>}</div>}
    {pricing.response && <div className="mt-4 rounded-xl border p-4"><h3 className="text-sm font-bold">Your proposed price</h3><p className="mt-1 font-bold">{priceLabel(pricing.response)}</p>{pricing.response.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{pricing.response.notes}</p>}</div>}
    {pricing.agreed && <p className="mt-4 rounded-xl bg-green-50 p-4 font-semibold">Agreed price: {priceLabel(pricing.agreed)}. Await John’s assignment confirmation.</p>}
    {open && <div className="mt-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">{pricing.status === 'offered' ? 'Your counteroffer (optional)' : 'Your flat price'}<input type="number" min="0.01" max="100000" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border p-3" placeholder="CAD" disabled={busy} /></label><label className="text-sm font-semibold">Tax on your proposed price<select value={tax} onChange={e => setTax(e.target.value as TaxTreatment)} className="mt-1 w-full rounded-lg border p-3" disabled={busy}><option value="">Choose tax treatment</option>{Object.entries(taxLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label className="block text-sm font-semibold">Crew, truck, questions or exclusions<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border p-3 font-normal" placeholder="Tell John what crew and truck you can provide and any assumptions. If declining, you can leave a reason here." disabled={busy} /></label>
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-1" disabled={busy} /><span>I have reviewed the date, inventory, access, special tasks and payment terms. I am available for this job. Any assumptions or exclusions are listed above for John’s approval.</span></label>
      <div className="flex flex-wrap gap-3">{pricing.status === 'offered' && <button onClick={() => respond('accept')} disabled={busy || !confirm} className="rounded-lg bg-[#071421] px-4 py-3 text-white disabled:opacity-40">Accept offered price</button>}<button onClick={() => respond(pricing.status === 'offered' ? 'counter' : 'submit')} disabled={busy || !confirm || !amount || !tax} className="rounded-lg bg-[#e6bd51] px-4 py-3 font-semibold disabled:opacity-40">{pricing.status === 'offered' ? 'Submit counteroffer' : 'Submit my flat price'}</button><button onClick={() => respond('decline')} disabled={busy} className="rounded-lg border px-4 py-3 disabled:opacity-40">Decline job</button></div>
      {pricing.status === 'offered' && <p className="text-xs text-slate-600">Accept uses Saturn’s displayed amount and tax terms. To change the price or terms, submit a counteroffer. Notes do not automatically amend an accepted offer.</p>}
    </div>}
    {!open && !pricing.agreed && <p className="mt-3 text-sm">Your response is recorded. Contact John if you need to change it, or check for an updated offer below.</p>}
    <button onClick={() => router.refresh()} disabled={busy} className="mt-4 text-sm text-blue-700 underline">Check for an updated offer</button>
    {busy && <p role="status" className="mt-3 text-sm">Saving your response…</p>}{message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>
}
