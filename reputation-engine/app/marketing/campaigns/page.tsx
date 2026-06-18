'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_DIRECT_MAIL_COST_PER_LETTER_CENTS, formatCadFromCents } from '@/lib/partnership-constants'

interface Campaign {
  id: string
  name: string
  industry: string
  tracking_code: string
  tier: string
  letters_sent: number
  sent_date: string
  cost_cents: number
  responses: number
  bookings: number
  revenue_cents: number
  notes: string
  live_letters_sent?: number
  live_responses?: number
  live_bookings?: number
  live_total?: number
}

const INDUSTRY_CODES = [
  { code: 'DL25', industry: 'Divorce Lawyers', tier: 'A' },
  { code: 'EL25', industry: 'Estate Lawyers', tier: 'A' },
  { code: 'MB25', industry: 'Mortgage Brokers', tier: 'A' },
  { code: 'HB25', industry: 'Home Builders', tier: 'B' },
  { code: 'IR25', industry: 'Insurance & Restoration', tier: 'B' },
  { code: 'CC25', industry: 'Condo Corporations', tier: 'B' },
  { code: 'LE25', industry: 'Large Employers', tier: 'C' },
  { code: 'EM25', industry: 'Engineering & Manufacturing', tier: 'C' },
  { code: 'HO25', industry: 'Hospitals & Healthcare', tier: 'C' },
  { code: 'UN25', industry: 'Universities & Colleges', tier: 'C' },
  { code: 'GV25', industry: 'Government', tier: 'C' },
  { code: 'CH25', industry: 'Churches', tier: 'D' },
  { code: 'NPWE25', industry: 'Nonprofits Windsor-Essex', tier: 'D' },
  { code: 'SC25', industry: 'Sports Clubs', tier: 'D' },
  { code: 'RH25', industry: 'Retirement & Care Homes', tier: 'E' },
  { code: 'FH25', industry: 'Funeral Homes', tier: 'E' },
  { code: 'HOT25', industry: 'Hot Signals', tier: 'A' },
]

function fmt(cents: number) {
  return formatCadFromCents(cents)
}

function roi(c: Campaign) {
  const letters = c.live_letters_sent ?? c.letters_sent
  if (c.revenue_cents <= 0 || letters <= 0) return null
  const cost = c.cost_cents > 0 ? c.cost_cents : letters * DEFAULT_DIRECT_MAIL_COST_PER_LETTER_CENTS
  return ((c.revenue_cents - cost) / cost * 100).toFixed(0)
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', tracking_code: 'DL25', letters_sent: '', sent_date: '', cost: '', notes: '' })
  const [editForm, setEditForm] = useState({ responses: '', bookings: '', revenue: '' })
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/marketing/campaigns', { credentials: 'include' })
    if (r.ok) setCampaigns(await r.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function addCampaign() {
    setBusy(true)
    const sel = INDUSTRY_CODES.find(x => x.code === form.tracking_code)
    await fetch('/api/marketing/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: form.name || `${sel?.industry ?? form.tracking_code} — ${form.sent_date || new Date().toISOString().slice(0,10)}`,
        tracking_code: form.tracking_code,
        industry: sel?.industry ?? '',
        tier: sel?.tier ?? '',
        letters_sent: parseInt(form.letters_sent) || 0,
        sent_date: form.sent_date || null,
        cost: parseFloat(form.cost) || 0,
        notes: form.notes,
      }),
    })
    setAddOpen(false)
    setForm({ name: '', tracking_code: 'DL25', letters_sent: '', sent_date: '', cost: '', notes: '' })
    setBusy(false)
    void load()
  }

  async function updateResults(id: string) {
    setBusy(true)
    await fetch('/api/marketing/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id,
        responses: parseInt(editForm.responses) || 0,
        bookings: parseInt(editForm.bookings) || 0,
        revenue: parseFloat(editForm.revenue) || 0,
      }),
    })
    setBusy(false)
    setEditId(null)
    void load()
  }

  // Summary totals
  const totals = campaigns.reduce((acc, c) => ({
    letters: acc.letters + (c.live_letters_sent ?? c.letters_sent),
    responses: acc.responses + (c.live_responses ?? c.responses),
    bookings: acc.bookings + (c.live_bookings ?? c.bookings),
    revenue: acc.revenue + c.revenue_cents,
    cost: acc.cost + (c.cost_cents || (c.live_letters_sent ?? c.letters_sent) * DEFAULT_DIRECT_MAIL_COST_PER_LETTER_CENTS),
  }), { letters: 0, responses: 0, bookings: 0, revenue: 0, cost: 0 })

  return (
    <div className="crm-shell space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Direct Mail ROI</h1>
          <p className="mt-1 text-sm text-slate-500">Track every campaign batch and see what's converting.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="crm-button-dark text-sm">+ Log Batch</button>
      </div>

      {/* Summary */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            { label: 'Letters Sent', val: totals.letters.toLocaleString() },
            { label: 'Responses', val: totals.responses },
            { label: 'Bookings', val: totals.bookings },
            { label: 'Revenue', val: fmt(totals.revenue) },
            { label: 'Total ROI', val: totals.revenue > 0 && totals.cost > 0 ? `${((totals.revenue - totals.cost) / totals.cost * 100).toFixed(0)}%` : '—' },
          ].map(item => (
            <div key={item.label} className="crm-panel p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
              <div className="mt-1 text-2xl font-bold text-[#1a2744]">{item.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Campaign list */}
      {loading ? (
        <div className="crm-panel p-12 text-center text-sm text-slate-400">Loading...</div>
      ) : campaigns.length === 0 ? (
        <div className="crm-panel p-12 text-center space-y-3">
          <div className="text-4xl">✉️</div>
          <div className="font-semibold text-[#1a2744]">No campaigns logged yet</div>
          <p className="text-sm text-slate-400">Every time you send a direct mail batch, log it here so you can track which codes are generating calls and bookings.</p>
        </div>
      ) : (
        <div className="crm-panel divide-y divide-slate-100">
          {campaigns.map(c => {
            const roiVal = roi(c)
            const letters = c.live_letters_sent ?? c.letters_sent
            const responses = c.live_responses ?? c.responses
            const bookings = c.live_bookings ?? c.bookings
            const responseRate = letters > 0 ? ((responses / letters) * 100).toFixed(1) : '—'
            const convRate = responses > 0 ? ((bookings / responses) * 100).toFixed(0) : '—'
            return (
              <div key={c.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400">
                      <span className="rounded-full bg-[#1a2744]/10 px-2 py-0.5 font-bold text-[#1a2744]">{c.tracking_code}</span>
                      {c.sent_date && <span>Sent {new Date(c.sent_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>}
                      {c.industry && <span>{c.industry}</span>}
                    </div>
                  </div>
                  {roiVal && (
                    <div className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${parseInt(roiVal) > 500 ? 'bg-emerald-100 text-emerald-800' : parseInt(roiVal) > 100 ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'}`}>
                      <div className="text-lg font-bold">{roiVal}%</div>
                      <div className="text-[10px] font-semibold">ROI</div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-3 text-center">
                  {[
                    { label: 'Sent', val: letters.toLocaleString() },
                    { label: 'Responses', val: `${responses} (${responseRate}%)` },
                    { label: 'Bookings', val: `${bookings} (${convRate}%)` },
                    { label: 'Revenue', val: c.revenue_cents > 0 ? fmt(c.revenue_cents) : '—' },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-slate-50 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
                      <div className="text-sm font-bold text-[#1a2744]">{item.val}</div>
                    </div>
                  ))}
                </div>

                {editId === c.id ? (
                  <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-4">
                    {[
                      { label: 'Responses', key: 'responses', ph: '0' },
                      { label: 'Bookings', key: 'bookings', ph: '0' },
                      { label: 'Revenue ($)', key: 'revenue', ph: '0.00' },
                    ].map(f => (
                      <label key={f.key} className="block">
                        <span className="crm-label">{f.label}</span>
                        <input
                          className="crm-input mt-1 w-28"
                          placeholder={f.ph}
                          value={editForm[f.key as keyof typeof editForm]}
                          onChange={e => setEditForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        />
                      </label>
                    ))}
                    <div className="flex gap-2">
                      <button onClick={() => void updateResults(c.id)} disabled={busy} className="crm-button-dark text-sm disabled:opacity-60">Save</button>
                      <button onClick={() => setEditId(null)} className="crm-button text-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditId(c.id)
                      setEditForm({ responses: String(c.responses), bookings: String(c.bookings), revenue: String(c.revenue_cents / 100) })
                    }}
                    className="text-xs font-medium text-[#1a2744] underline underline-offset-2"
                  >
                    Update results
                  </button>
                )}
                {c.notes && <div className="text-xs text-slate-400">{c.notes}</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Add modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }} onClick={e => { if (e.target === e.currentTarget) setAddOpen(false) }}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-[#1a2744] px-6 py-5" style={{ borderBottom: '2px solid #f5a623' }}>
              <h2 className="font-bold text-white">Log Direct Mail Batch</h2>
              <p className="mt-0.5 text-xs text-white/60">Track how many letters you sent and to which audience.</p>
            </div>
            <div className="p-6 space-y-4">
              <label className="block">
                <span className="crm-label">Campaign Code</span>
                <select className="crm-input mt-1" value={form.tracking_code} onChange={e => setForm(f => ({ ...f, tracking_code: e.target.value }))}>
                  {INDUSTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.industry}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="crm-label">Letters Sent</span>
                  <input className="crm-input mt-1" type="number" placeholder="100" value={form.letters_sent} onChange={e => setForm(f => ({ ...f, letters_sent: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="crm-label">Date Sent</span>
                  <input className="crm-input mt-1" type="date" value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} />
                </label>
              </div>
              <label className="block">
                <span className="crm-label">Total Cost ($) <span className="font-normal text-slate-400">— default $2/letter if blank</span></span>
                <input className="crm-input mt-1" type="number" placeholder="200.00" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />
              </label>
              <label className="block">
                <span className="crm-label">Notes</span>
                <textarea className="crm-input mt-1 h-16 resize-none" placeholder="e.g. Focused on Windsor East, used updated DL25 template" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </label>
              <div className="flex gap-3">
                <button onClick={() => setAddOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
                <button onClick={() => void addCampaign()} disabled={busy} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-bold text-white disabled:opacity-60">Save Batch</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
