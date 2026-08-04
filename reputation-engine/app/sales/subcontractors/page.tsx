'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Subcontractor, SubcontractorOffer, SubcontractorOfferRecipient } from '@/lib/subcontractors'

type Job = { leadId: string; quoteId?: string; name: string; moveDate?: string; branch?: string; route: string }
type Data = { subcontractors: Subcontractor[]; offers: SubcontractorOffer[]; recipients: SubcontractorOfferRecipient[]; jobs: Job[] }
const SERVICE_AREAS = [
  'London and surrounding areas',
  'Windsor and surrounding areas',
] as const

export default function SubcontractorsPage() {
  const [data, setData] = useState<Data>({ subcontractors: [], offers: [], recipients: [], jobs: [] })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [jobId, setJobId] = useState('')
  const [payout, setPayout] = useState('')
  const [scopeNotes, setScopeNotes] = useState('')
  const [serviceAreas, setServiceAreas] = useState<string[]>([])
  const [form, setForm] = useState({ companyName: '', contactName: '', phone: '', email: '', truckSizes: '', maxCrewSize: '', notes: '' })

  async function load() {
    const response = await fetch('/api/sales/subcontractors', { cache: 'no-store' })
    const payload = await response.json()
    if (response.ok) setData(payload); else setNotice(payload.error || 'Could not load subcontractors.')
  }
  useEffect(() => { void load() }, [])
  const job = data.jobs.find(item => item.leadId === jobId)
  const recipientCounts = useMemo(() => new Map(data.offers.map(offer => [offer.id, data.recipients.filter(r => r.offer_id === offer.id)])), [data])

  async function post(body: Record<string, unknown>) {
    setBusy(true); setNotice('')
    try {
      const response = await fetch('/api/sales/subcontractors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({ error: `Server returned ${response.status}` }))
      setNotice(response.ok ? 'Saved successfully.' : payload.error || 'Action failed.')
      if (response.ok) {
        await load()
        if (body.action === 'create_subcontractor') {
          setForm({ companyName: '', contactName: '', phone: '', email: '', truckSizes: '', maxCrewSize: '', notes: '' })
          setServiceAreas([])
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="min-h-screen bg-[#F7F4ED] p-5 text-[#071421]">
    <div className="mx-auto max-w-7xl space-y-6">
      <header><div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8A6800]">Admin dispatch network</div><h1 className="mt-1 text-3xl font-extrabold">Subcontractors</h1><p className="mt-1 text-sm text-slate-500">Manage approved partners, privately blast sanitized job offers, and award each job to the first acceptance.</p></header>
      {notice ? <div className="rounded-xl border bg-white p-3 text-sm">{notice}</div> : null}

      <section className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold">Add subcontractor</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              ['companyName', 'Company name', 'text'],
              ['contactName', 'Contact name', 'text'],
              ['phone', 'Mobile number', 'tel'],
              ['email', 'Email', 'email'],
              ['truckSizes', 'Truck sizes / access', 'text'],
              ['maxCrewSize', 'Maximum crew size', 'number'],
              ['notes', 'Internal notes', 'text'],
            ] as const).map(([key, label, type]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input type={type} min={type === 'number' ? 1 : undefined} value={form[key]} onChange={e => setForm(current => ({ ...current, [key]: e.target.value }))} placeholder={label} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-[#071421]" /></label>)}
            <label className="text-xs font-semibold text-slate-600">
              Service areas
              <select
                value=""
                onChange={e => {
                  const area = e.target.value
                  if (area) setServiceAreas(current => current.includes(area) ? current : [...current, area])
                }}
                className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm font-normal text-[#071421]"
              >
                <option value="">Choose a city area…</option>
                {SERVICE_AREAS.filter(area => !serviceAreas.includes(area)).map(area => <option key={area} value={area}>{area}</option>)}
              </select>
              <span className="mt-2 flex flex-wrap gap-2">
                {serviceAreas.map(area => <button key={area} type="button" onClick={() => setServiceAreas(current => current.filter(item => item !== area))} className="rounded-full bg-[#F3E9C4] px-3 py-1 text-xs font-semibold text-[#6E5300]">{area} ×</button>)}
                {!serviceAreas.length ? <span className="font-normal text-slate-400">No area selected</span> : null}
              </span>
            </label>
          </div>
          <button disabled={busy || !form.companyName.trim() || !form.contactName.trim() || form.phone.replace(/\D/g, '').length < 10 || !serviceAreas.length} onClick={() => void post({ action: 'create_subcontractor', ...form, serviceCities: serviceAreas.join(',') })} className="mt-3 rounded-xl bg-[#071421] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Saving partner…' : 'Add approved partner'}</button>
        </div>
        <div className="rounded-2xl bg-[#071421] p-5 text-white shadow-sm">
          <h2 className="font-bold">Create and blast job offer</h2>
          <select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-4 w-full rounded-xl border-white/20 bg-white/10 px-3 py-2 text-sm"><option value="" className="text-black">Choose booked job</option>{data.jobs.map(item => <option className="text-black" key={item.leadId} value={item.leadId}>{item.moveDate || 'TBD'} · {item.route}</option>)}</select>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><input value={payout} onChange={e => setPayout(e.target.value)} type="number" placeholder="Your offered payout" className="rounded-xl border-white/20 bg-white/10 px-3 py-2 text-sm"/><input value={scopeNotes} onChange={e => setScopeNotes(e.target.value)} placeholder="Sanitized scope note" className="rounded-xl border-white/20 bg-white/10 px-3 py-2 text-sm"/></div>
          <div className="mt-4 grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">{data.subcontractors.filter(s => s.status === 'active').map(s => <label key={s.id} className="flex items-center gap-2 rounded-xl bg-white/10 p-3 text-sm"><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))}/><span><strong>{s.company_name}</strong><br/><span className="text-white/55">{s.service_cities.join(', ') || 'All areas'}</span></span></label>)}</div>
          <button disabled={busy || !job || !Number(payout) || !selected.length} onClick={() => void post({ action: 'create_offer', leadId: job?.leadId, quoteId: job?.quoteId, payout: Number(payout), scopeNotes, subcontractorIds: selected })} className="mt-4 rounded-xl bg-[#C99700] px-4 py-3 text-sm font-extrabold text-[#071421] disabled:opacity-40">Blast offer to {selected.length} subcontractor{selected.length === 1 ? '' : 's'}</button>
        </div>
      </section>

      <section className="rounded-2xl bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">Approved network</h2></div><div className="divide-y">{data.subcontractors.map(s => <div key={s.id} className="grid gap-2 p-4 text-sm sm:grid-cols-5"><strong>{s.company_name}</strong><span>{s.contact_name}</span><span>{s.phone}</span><span>{s.service_cities.join(', ') || 'All areas'}</span><span className="font-semibold capitalize">{s.status}{s.insured ? ' · insured' : ''}</span></div>)}{!data.subcontractors.length ? <div className="p-6 text-sm text-slate-500">No subcontractors registered yet.</div> : null}</div></section>

      <section className="rounded-2xl bg-white shadow-sm"><div className="border-b p-5"><h2 className="font-bold">Offer history</h2></div><div className="divide-y">{data.offers.map(offer => { const rs = recipientCounts.get(offer.id) || []; return <div key={offer.id} className="grid gap-2 p-4 text-sm sm:grid-cols-6"><strong>{offer.move_date || 'TBD'}</strong><span>{offer.origin_city} → {offer.destination_city}</span><span>${Number(offer.offered_payout).toFixed(2)}</span><span className="capitalize">{offer.status}</span><span>{rs.filter(r => r.status === 'accepted').length} accepted · {rs.filter(r => r.status === 'discussion').length} discuss</span><button disabled={offer.status !== 'open'} onClick={() => void post({ action: 'cancel_offer', offerId: offer.id })} className="text-left font-semibold text-rose-700 disabled:text-slate-300">Cancel</button></div>})}</div></section>
    </div>
  </main>
}
