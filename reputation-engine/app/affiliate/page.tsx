'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface Partner {
  id: string
  name: string
  email: string | null
  company: string | null
  type: string
  commissionRate: number
  commissionType: string
  totalJobsReferred: number
}

interface Submission {
  id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  move_date: string | null
  move_size: string | null
  origin_city: string | null
  dest_city: string | null
  status: string
  commission_amount: number
  commission_paid: boolean
  created_at: string
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Received',  color: 'bg-blue-100 text-blue-700' },
  contacted: { label: 'Contacted', color: 'bg-amber-100 text-amber-700' },
  quoted:    { label: 'Quoted',    color: 'bg-purple-100 text-purple-700' },
  booked:    { label: 'Booked',    color: 'bg-emerald-100 text-emerald-700' },
  won:       { label: 'Won ✓',     color: 'bg-emerald-100 text-emerald-800 font-semibold' },
  lost:      { label: 'Not booked', color: 'bg-slate-100 text-slate-500' },
}

const MOVE_SIZES = ['Studio / Bachelor', '1 Bedroom', '2 Bedrooms', '3 Bedrooms', '4 Bedrooms', '5+ Bedrooms / Full House', 'Office / Commercial', 'Other']

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function AffiliatePortal() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [partner, setPartner] = useState<Partner | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'home' | 'submit' | 'history'>('home')

  // Submit form state
  const [form, setForm] = useState({ customer_name: '', customer_phone: '', customer_email: '', move_date: '', move_size: '', origin_city: '', dest_city: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setLoading(false); setError('Invalid link — please contact Saturn Star Movers for your partner link.'); return }
    Promise.all([
      fetch(`/api/affiliate/auth?token=${token}`).then(r => r.json()),
      fetch(`/api/affiliate/leads?token=${token}`).then(r => r.json()),
    ]).then(([p, s]) => {
      if (p.error) { setError(p.error); return }
      setPartner(p)
      setSubmissions(s.submissions || [])
    }).catch(() => setError('Could not load your portal. Please try again.'))
    .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.customer_name.trim()) { setFormError('Customer name is required'); return }
    setSubmitting(true); setFormError(null)
    const res = await fetch(`/api/affiliate/leads?token=${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json() as { ok?: boolean; error?: string; submission?: Submission }
    if (!res.ok || !data.ok) { setFormError(data.error || 'Submission failed'); setSubmitting(false); return }
    if (data.submission) setSubmissions(prev => [data.submission!, ...prev])
    setSubmitted(true); setSubmitting(false)
  }

  const wonJobs = submissions.filter(s => s.status === 'won').length
  const pendingJobs = submissions.filter(s => ['pending', 'contacted', 'quoted', 'booked'].includes(s.status)).length
  const totalEarned = submissions.filter(s => s.status === 'won').reduce((sum, s) => sum + (s.commission_amount || 0), 0)
  const pendingPayout = submissions.filter(s => s.status === 'won' && !s.commission_paid).reduce((sum, s) => sum + (s.commission_amount || 0), 0)

  if (loading) return (
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center">
      <h1 className="sr-only">Saturn Star partner portal</h1><div role="status" className="text-slate-500 text-sm">Loading your portal…</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center p-4">
      <h1 className="sr-only">Saturn Star partner portal</h1>
      <div className="rounded-[20px] bg-white p-8 max-w-sm w-full text-center shadow-sm">
        <div className="text-3xl mb-4">🔒</div>
        <div className="text-sm font-semibold text-slate-800 mb-2">Access Required</div>
        <div className="text-sm text-slate-500">{error}</div>
        <div className="mt-6 text-xs text-slate-400">Contact us: <a href="tel:+12267732993" className="underline">226-773-2993</a></div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f4f6f8]">
      <h1 className="sr-only">Saturn Star partner portal</h1>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #071421 0%, #0f6a53 100%)' }} className="px-4 py-6">
        <div className="mx-auto max-w-lg">
          <div className="text-white/60 text-[11px] font-semibold uppercase tracking-widest mb-1">Local Partner Network</div>
          <div className="text-white text-xl font-bold">Saturn Star Movers</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm">
              {(partner?.name || 'P').charAt(0)}
            </div>
            <div>
              <div className="text-white font-semibold text-sm">{partner?.name}</div>
              {partner?.company && <div className="text-white/60 text-[11px]">{partner.company}</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg px-4 py-6 space-y-4">

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Clients Referred', value: submissions.length, sub: `${wonJobs} completed` },
            { label: 'In Progress', value: pendingJobs, sub: 'being worked' },
            { label: 'Credited Rewards', value: `$${totalEarned}`, sub: partner?.commissionType === 'per_job' ? `after completed paid moves` : `${partner?.commissionRate}% after completion` },
            { label: 'Pending Payout', value: `$${pendingPayout}`, sub: pendingPayout > 0 ? 'ready for payout' : 'nothing due yet' },
          ].map(s => (
            <div key={s.label} className="rounded-[16px] bg-white p-4 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{s.label}</div>
              <div className="mt-1 text-2xl font-bold text-[#071421]">{s.value}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => { setView('submit'); setSubmitted(false); setForm({ customer_name: '', customer_phone: '', customer_email: '', move_date: '', move_size: '', origin_city: '', dest_city: '', notes: '' }) }}
            className="rounded-[16px] py-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #0f6a53 0%, #1a9070 100%)' }}>
            + Refer a Client
          </button>
          <button onClick={() => setView('history')}
            className="rounded-[16px] bg-white py-4 text-sm font-semibold text-[#071421] shadow-sm border border-slate-200 hover:bg-slate-50 transition">
            View History →
          </button>
        </div>

        {/* How it works */}
        <div className="rounded-[16px] bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-[#071421] mb-3">How the network works</div>
          <div className="space-y-3">
            {[
              { n: '1', title: 'Introduce the client', desc: 'Send their name and contact details when moving help comes up.' },
              { n: '2', title: 'We protect your reputation', desc: 'SSM contacts them, quotes clearly, and keeps the move organized.' },
              { n: '3', title: 'Reward after completion', desc: `Rewards are credited only after the client completes a paid move.` },
            ].map(s => (
              <div key={s.n} className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-[#0f6a53] text-white text-xs font-bold flex items-center justify-center shrink-0">{s.n}</div>
                <div>
                  <div className="text-sm font-semibold text-[#071421]">{s.title}</div>
                  <div className="text-[11px] text-slate-500">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-[11px] text-slate-400 pb-4">
          Questions? Call us at <a href="tel:+12267732993" className="underline">226-773-2993</a>
        </div>
      </div>

      {/* Submit Lead Drawer */}
      {view === 'submit' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f4f6f8]">
          <div style={{ background: 'linear-gradient(135deg, #071421 0%, #0f6a53 100%)' }} className="px-4 py-5 flex items-center gap-3">
            <button onClick={() => setView('home')} className="text-white/70 hover:text-white text-sm">← Back</button>
            <div className="text-white font-semibold">Refer a Client</div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6">
            {submitted ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-5xl mb-4">🎉</div>
                <div className="text-lg font-bold text-[#071421]">Referral submitted!</div>
                <div className="text-sm text-slate-500 mt-2">Our team will reach out to your client shortly.</div>
                <div className="text-sm text-slate-500 mt-1">You'll see this lead in your history once we've made contact.</div>
                <button onClick={() => setView('home')} className="mt-6 rounded-[12px] bg-[#0f6a53] px-6 py-2.5 text-sm font-semibold text-white">
                  Back to Portal
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto">
                <div className="rounded-[16px] bg-white p-5 shadow-sm space-y-4">
                  <div className="text-sm font-semibold text-[#071421]">Client Information</div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Full Name *</label>
                    <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} required
                      placeholder="Sarah Johnson"
                      className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Phone</label>
                      <input type="tel" value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))}
                        placeholder="519-555-0100"
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Email</label>
                      <input type="email" value={form.customer_email} onChange={e => setForm(f => ({ ...f, customer_email: e.target.value }))}
                        placeholder="sarah@email.com"
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] bg-white p-5 shadow-sm space-y-4">
                  <div className="text-sm font-semibold text-[#071421]">Move Details (optional but helpful)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moving From</label>
                      <input value={form.origin_city} onChange={e => setForm(f => ({ ...f, origin_city: e.target.value }))}
                        placeholder="Windsor"
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Moving To</label>
                      <input value={form.dest_city} onChange={e => setForm(f => ({ ...f, dest_city: e.target.value }))}
                        placeholder="Toronto"
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Move Date</label>
                      <input type="date" value={form.move_date} onChange={e => setForm(f => ({ ...f, move_date: e.target.value }))}
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Home Size</label>
                      <select value={form.move_size} onChange={e => setForm(f => ({ ...f, move_size: e.target.value }))}
                        className="mt-1 block w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]">
                        <option value="">Select…</option>
                        {MOVE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Notes (anything else we should know?)</label>
                    <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                      placeholder="e.g. They have a piano, elevator access, flexible on dates…"
                      className="mt-1 block w-full resize-none rounded-[10px] border border-slate-200 px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0f6a53]" />
                  </div>
                </div>

                {formError && <div className="rounded-[10px] bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</div>}

                <button type="submit" disabled={submitting}
                  className="w-full rounded-[14px] py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #0f6a53 0%, #1a9070 100%)' }}>
                  {submitting ? 'Submitting…' : 'Submit Referral →'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* History Drawer */}
      {view === 'history' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f4f6f8]">
          <div style={{ background: 'linear-gradient(135deg, #071421 0%, #0f6a53 100%)' }} className="px-4 py-5 flex items-center gap-3">
            <button onClick={() => setView('home')} className="text-white/70 hover:text-white text-sm">← Back</button>
            <div className="text-white font-semibold">Your Referrals ({submissions.length})</div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {submissions.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-3xl mb-3">📋</div>
                <div className="text-sm font-semibold text-slate-600">No referrals yet</div>
                <div className="text-xs text-slate-400 mt-1">Submit your first referral to start tracking</div>
              </div>
            ) : submissions.map(s => {
              const meta = STATUS_META[s.status] || { label: s.status, color: 'bg-slate-100 text-slate-500' }
              return (
                <div key={s.id} className="rounded-[16px] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#071421] truncate">{s.customer_name}</div>
                      {(s.origin_city || s.dest_city) && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {s.origin_city}{s.dest_city ? ` → ${s.dest_city}` : ''}
                        </div>
                      )}
                      {(s.customer_phone || s.customer_email) && (
                        <div className="text-[11px] text-slate-400">{s.customer_phone || s.customer_email}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
                      {s.status === 'won' && s.commission_amount > 0 && (
                        <div className={`mt-1 text-[11px] font-semibold ${s.commission_paid ? 'text-emerald-600' : 'text-amber-600'}`}>
                          ${s.commission_amount} {s.commission_paid ? '✓ Paid' : 'Pending'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-400">
                    Submitted {fmtDate(s.created_at)}
                    {s.move_date && ` · Move: ${s.move_date}`}
                    {s.move_size && ` · ${s.move_size}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AffiliatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center text-sm text-slate-500">Loading…</div>}>
      <AffiliatePortal />
    </Suspense>
  )
}
