'use client'

import { useEffect, useState } from 'react'

interface Signal {
  id: string
  signal_type: string
  company: string
  city: string
  description: string
  contact_name: string
  time_sensitivity: string
  action_required: string
  status: string
  notes: string
  created_at: string
  claimed_by?: string | null
}

const SIGNAL_COLORS: Record<string, string> = {
  'NEW PLANT': 'bg-rose-100 text-rose-700 border-rose-200',
  'EV BATTERY PLANT': 'bg-rose-100 text-rose-700 border-rose-200',
  'EXPANSION': 'bg-amber-100 text-amber-700 border-amber-200',
  'HIRING': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'RELOCATION': 'bg-sky-100 text-sky-700 border-sky-200',
  'NEW DEVELOPMENT': 'bg-purple-100 text-purple-700 border-purple-200',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new:      { label: 'New', color: 'bg-rose-500 text-white' },
  actioned: { label: 'Actioned', color: 'bg-emerald-100 text-emerald-700' },
  watching: { label: 'Watching', color: 'bg-amber-100 text-amber-700' },
  passed:   { label: 'Passed', color: 'bg-slate-100 text-slate-500' },
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ signal_type: '', company: '', city: 'Windsor', description: '', contact_name: '', time_sensitivity: '', action_required: '' })
  const [busy, setBusy] = useState(false)
  const [blasting, setBlasting] = useState<string | null>(null)
  const [blasted, setBlasted] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    const r = await fetch('/api/marketing/signals', { credentials: 'include' })
    if (r.ok) setSignals(await r.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function updateStatus(id: string, status: string, notes?: string, claim = false) {
    await fetch('/api/marketing/signals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, status, notes, claim }),
    })
    setSignals(prev => prev.map(s => s.id === id ? { ...s, status, claimed_by: claim ? 'Claimed' : s.claimed_by } : s))
  }

  async function blastSignal(s: Signal) {
    setBlasting(s.id)
    await fetch('/api/marketing/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'blast_signal',
        signal_id: s.id,
        signal_company: s.company,
        signal_type: s.signal_type,
        signal_description: s.description,
      }),
    })
    setBlasted(prev => new Set(Array.from(prev).concat(s.id)))
    setSignals(prev => prev.map(x => x.id === s.id ? { ...x, status: 'watching' } : x))
    setBlasting(null)
  }

  async function addSignal() {
    setBusy(true)
    await fetch('/api/marketing/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    })
    setBusy(false)
    setAddOpen(false)
    setForm({ signal_type: '', company: '', city: 'Windsor', description: '', contact_name: '', time_sensitivity: '', action_required: '' })
    void load()
  }

  const active = signals.filter(s => s.status === 'new' || s.status === 'watching')
  const past = signals.filter(s => s.status === 'actioned' || s.status === 'passed')

  return (
    <div className="crm-shell space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#071421]">Signals</h1>
          <p className="mt-1 text-sm text-slate-500">Fast-response opportunities that should feed the partnership and corporate outreach queue.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="crm-button-dark text-sm">+ Add Signal</button>
      </div>

      {/* Active signals */}
      {loading ? (
        <div className="crm-panel p-12 text-center text-sm text-slate-400">Loading signals...</div>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#071421]">Active Signals ({active.length})</h2>
              {active.map(s => {
                const colorClass = SIGNAL_COLORS[s.signal_type] ?? 'bg-slate-100 text-slate-700 border-slate-200'
                const statusMeta = STATUS_LABELS[s.status] ?? STATUS_LABELS.new
                return (
                  <div key={s.id} className={`rounded-xl border p-5 space-y-3 ${colorClass.split(' ')[2] ?? 'border-slate-200'} bg-white`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${colorClass.split(' ').slice(0,2).join(' ')}`}>
                          {s.signal_type || 'SIGNAL'}
                        </span>
                        <div>
                          <div className="font-bold text-[#071421]">{s.company}</div>
                          <div className="text-xs text-slate-500">📍 {s.city}</div>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta.color}`}>
                        {statusMeta.label}
                      </span>
                    </div>

                    {s.description && <p className="text-sm text-slate-700">{s.description}</p>}

                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      {s.contact_name && <span>👤 {s.contact_name}</span>}
                      {s.time_sensitivity && <span className="font-medium text-rose-600">⚡ {s.time_sensitivity}</span>}
                      {s.claimed_by && <span>🧷 {s.claimed_by}</span>}
                    </div>

                    {s.action_required && (
                      <div className="rounded-lg bg-[#071421]/5 px-3 py-2 text-xs text-[#071421]">
                        <span className="font-semibold">Action: </span>{s.action_required}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {blasted.has(s.id) ? (
                        <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                          🚀 Blasted — 4 tasks added to Queue
                        </span>
                      ) : (
                        <button
                          onClick={() => void blastSignal(s)}
                          disabled={blasting === s.id}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-60"
                        >
                          {blasting === s.id ? 'Blasting...' : '🚨 Hit All Channels'}
                        </button>
                      )}
                      {s.status === 'new' && (
                        <button onClick={() => void updateStatus(s.id, 'watching', undefined, true)} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition">
                          👁 Claim
                        </button>
                      )}
                      <button onClick={() => void updateStatus(s.id, 'actioned')} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition">
                        ✓ Mark Actioned
                      </button>
                      <button onClick={() => void updateStatus(s.id, 'passed')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition">
                        Pass
                      </button>
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          {active.length === 0 && (
            <div className="crm-panel p-12 text-center space-y-3">
              <div className="text-4xl">📡</div>
              <div className="font-semibold text-[#071421]">No active signals</div>
              <p className="text-sm text-slate-400">Watch local news for business expansions, new plants, large employers hiring — then add them here to track your outreach.</p>
            </div>
          )}

          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Actioned / Past ({past.length})</h2>
              {past.map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                  <span className="text-xs text-slate-400 line-through">{s.company}</span>
                  <span className="text-xs text-slate-400">{s.city}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_LABELS[s.status]?.color ?? 'bg-slate-100 text-slate-500'}`}>
                    {STATUS_LABELS[s.status]?.label}
                  </span>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {/* Add signal modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }} onClick={e => { if (e.target === e.currentTarget) setAddOpen(false) }}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-none overflow-hidden">
            <div className="bg-[#071421] px-6 py-5" style={{ borderBottom: '2px solid #C99700' }}>
              <h2 className="font-bold text-white">Add Signal</h2>
              <p className="mt-0.5 text-xs text-white/60">Log a move opportunity you spotted in the news or intel.</p>
            </div>
            <div className="p-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="crm-label">Signal Type</span>
                  <input className="crm-input mt-1" placeholder="e.g. NEW PLANT" value={form.signal_type} onChange={e => setForm(f => ({ ...f, signal_type: e.target.value.toUpperCase() }))} />
                </label>
                <label className="block">
                  <span className="crm-label">City</span>
                  <input className="crm-input mt-1" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </label>
              </div>
              <label className="block">
                <span className="crm-label">Company / Organization</span>
                <input className="crm-input mt-1" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} />
              </label>
              <label className="block">
                <span className="crm-label">What's the opportunity?</span>
                <textarea className="crm-input mt-1 h-16 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </label>
              <label className="block">
                <span className="crm-label">Contact / Source</span>
                <input className="crm-input mt-1" placeholder="HR Director name or news source" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
              </label>
              <label className="block">
                <span className="crm-label">Action Required</span>
                <input className="crm-input mt-1" placeholder="e.g. Reach out to HR for relocation partnership" value={form.action_required} onChange={e => setForm(f => ({ ...f, action_required: e.target.value }))} />
              </label>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setAddOpen(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600">Cancel</button>
                <button onClick={() => void addSignal()} disabled={busy || !form.company} className="flex-1 rounded-xl bg-[#071421] py-2.5 text-sm font-bold text-white disabled:opacity-60">Add Signal</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
