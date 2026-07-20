'use client'

import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

const PARTNER_TYPES = [
  'Realtor / brokerage',
  'Mortgage broker',
  'Storage facility',
  'Property manager',
  'Senior living / downsizing',
  'Lawyer / estate professional',
  'Insurance broker',
  'HR / relocation',
  'Cleaner / junk removal',
  'Contractor / renovation',
  'Past customer',
  'Other',
]

const MOVE_SIZES = [
  'Small local move',
  'Standard local move',
  'Large local move',
  'Long-distance move',
  'Commercial / institutional',
  'Not sure yet',
]

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

export function PartnerReferralForm({ pathCode = '' }: { pathCode?: string }) {
  const searchParams = useSearchParams()
  const initialCode = useMemo(() => normalizeCode(pathCode || searchParams.get('code') || searchParams.get('ref') || ''), [pathCode, searchParams])
  const initialPartnerName = searchParams.get('partner') || searchParams.get('name') || ''
  const initialMarket = searchParams.get('market') || ''
  const initialType = searchParams.get('type') || ''

  const [form, setForm] = useState({
    partner_code: initialCode,
    partner_name: initialPartnerName,
    partner_type: initialType,
    market: initialMarket,
    client_name: '',
    client_phone: '',
    client_email: '',
    moving_from: '',
    moving_to: '',
    move_date: '',
    move_size: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{ leadId?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(current => ({ ...current, [key]: key === 'partner_code' ? normalizeCode(value) : value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!form.partner_code) {
      setError('Add a partner code so the referral can be credited.')
      return
    }
    if (!form.client_name.trim()) {
      setError('Add the client name.')
      return
    }
    if (!form.client_phone.trim() && !form.client_email.trim()) {
      setError('Add at least a phone number or email for the client.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/partners/referral-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          source_url: typeof window !== 'undefined' ? window.location.href : '',
        }),
      })
      const data = await res.json().catch(() => null) as { ok?: boolean; error?: string; leadId?: string } | null
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Could not submit referral. Try again or call Saturn Star Movers.')
        return
      }
      setSubmitted({ leadId: data.leadId })
      setForm(current => ({
        ...current,
        client_name: '',
        client_phone: '',
        client_email: '',
        moving_from: '',
        moving_to: '',
        move_date: '',
        move_size: '',
        notes: '',
      }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-[#071421]">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid min-h-[92dvh] max-w-6xl gap-8 px-4 py-6 md:grid-cols-[0.9fr_1.1fr] md:px-8 md:py-10">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <div className="flex items-center gap-3">
                <Image src="/saturn-star-logo.png" alt="Saturn Star Movers" width={44} height={44} className="rounded-lg" priority />
                <div>
                  <div className="text-sm font-semibold">Saturn Star Movers</div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Local Partner Network</div>
                </div>
              </div>

              <div className="mt-12 max-w-xl">
                <h1 className="text-4xl font-semibold tracking-tight text-[#111827] md:text-5xl">Refer a moving client without the back-and-forth.</h1>
                <p className="mt-5 text-base leading-7 text-slate-600">
                  Send us the client details. We contact them, quote the move, track attribution, and credit the partner only after a completed paid move.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['01', 'Submit the client'],
                ['02', 'SSM handles quote'],
                ['03', 'Partner credited after completion'],
              ].map(([n, label]) => (
                <div key={n} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-bold text-emerald-700">{n}</div>
                  <div className="mt-2 text-sm font-semibold leading-5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center">
            <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              {submitted ? (
                <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</div>
                  <h2 className="mt-5 text-2xl font-semibold">Referral received</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    The lead is now tagged in the CRM with this partner code. Our team will follow up and track the move from quote to completion.
                  </p>
                  <button
                    onClick={() => setSubmitted(null)}
                    className="mt-6 min-h-11 rounded-full bg-[#071421] px-5 text-sm font-semibold text-white"
                  >
                    Submit another referral
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <h2 className="text-xl font-semibold">Partner referral intake</h2>
                    <p className="mt-1 text-sm text-slate-500">Use this for real estate, storage, senior living, HR, contractors, and local housing partners.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Partner code</span>
                      <input value={form.partner_code} onChange={e => set('partner_code', e.target.value)} required placeholder="SARAH100"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Partner name</span>
                      <input value={form.partner_name} onChange={e => set('partner_name', e.target.value)} placeholder="Sarah / Royal Windsor"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Partner type</span>
                      <select value={form.partner_type} onChange={e => set('partner_type', e.target.value)}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]">
                        <option value="">Select type</option>
                        {PARTNER_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Market / city</span>
                      <input value={form.market} onChange={e => set('market', e.target.value)} placeholder="Windsor, London, Waterloo..."
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                  </div>

                  <div className="h-px bg-slate-200" />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client name</span>
                      <input value={form.client_name} onChange={e => set('client_name', e.target.value)} required placeholder="Client full name"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client phone</span>
                      <input value={form.client_phone} onChange={e => set('client_phone', e.target.value)} placeholder="519-555-0100"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Client email</span>
                      <input type="email" value={form.client_email} onChange={e => set('client_email', e.target.value)} placeholder="client@email.com"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moving from</span>
                      <input value={form.moving_from} onChange={e => set('moving_from', e.target.value)} placeholder="Pickup city or address"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moving to</span>
                      <input value={form.moving_to} onChange={e => set('moving_to', e.target.value)} placeholder="Destination city or address"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Move date</span>
                      <input type="date" value={form.move_date} onChange={e => set('move_date', e.target.value)}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Move size</span>
                      <select value={form.move_size} onChange={e => set('move_size', e.target.value)}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#071421] outline-none focus:border-[#0f6a53]">
                        <option value="">Select size</option>
                        {MOVE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Notes</span>
                      <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                        placeholder="Context, timing, access, client preference, or how you introduced us."
                        className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </label>
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">
                    Partner rewards are credited only after the referred move is completed and paid. No payouts for quotes, cancelled jobs, or unverified leads.
                  </div>
                  {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
                  <button disabled={submitting} className="min-h-12 w-full rounded-full bg-[#0f6a53] px-5 text-sm font-semibold text-white transition hover:bg-[#0c5947] disabled:opacity-50">
                    {submitting ? 'Submitting...' : 'Submit referral'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
