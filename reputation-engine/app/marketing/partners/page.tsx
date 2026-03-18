'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface MarketContact {
  id: string
  name: string
  company: string
  title: string
  email: string
  phone: string
  website: string
  address: string
  city: string
  industry: string
  tier: string
  tracking_code: string
  stage: string
  notes: string
  last_touch_at: string | null
  next_follow_up: string | null
}

interface Touch {
  id: string
  channel: string
  direction: string
  notes: string
  created_by: string
  created_at: string
}

const STAGES = ['cold','contacted','engaged','qualified','partnered','referring','revisit','dnc']
const STAGE_LABELS: Record<string, string> = {
  cold: 'Cold', contacted: 'Contacted', engaged: 'Engaged',
  qualified: 'Qualified', partnered: 'Partnered', referring: 'Referring',
  revisit: 'Revisit', dnc: 'DNC',
}
const STAGE_COLORS: Record<string, string> = {
  cold: 'bg-slate-100 text-slate-600',
  contacted: 'bg-sky-100 text-sky-700',
  engaged: 'bg-amber-100 text-amber-700',
  qualified: 'bg-orange-100 text-orange-700',
  partnered: 'bg-emerald-100 text-emerald-700',
  referring: 'bg-green-600 text-white',
  revisit: 'bg-purple-100 text-purple-700',
  dnc: 'bg-red-100 text-red-600',
}
const TIERS = ['A','B','C','D','E']
const CHANNELS = ['email','direct_mail','phone','in_person','linkedin','sms']
const CHANNEL_ICONS: Record<string, string> = {
  email: '📧', direct_mail: '✉️', phone: '📞', in_person: '🤝', linkedin: '💼', sms: '💬',
}

function daysSince(dateStr: string | null) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function PartnersInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [contacts, setContacts] = useState<MarketContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const LIMIT = 30

  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') ?? '')
  const [tierFilter, setTierFilter] = useState(searchParams.get('tier') ?? '')
  const [query, setQuery] = useState('')

  const [selected, setSelected] = useState<MarketContact | null>(null)
  const [touches, setTouches] = useState<Touch[]>([])
  const [touchLoading, setTouchLoading] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logForm, setLogForm] = useState({ channel: 'phone', direction: 'outbound', notes: '', new_stage: '' })
  const [editNotes, setEditNotes] = useState('')
  const [editFollowUp, setEditFollowUp] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (reset = false) => {
    setLoading(true)
    const off = reset ? 0 : offset
    const params = new URLSearchParams({
      limit: String(LIMIT),
      offset: String(off),
    })
    if (stageFilter) params.set('stage', stageFilter)
    if (tierFilter) params.set('tier', tierFilter)
    if (query.trim()) params.set('q', query.trim())

    const r = await fetch(`/api/marketing/contacts?${params}`, { credentials: 'include' })
    if (r.ok) {
      const data = await r.json()
      if (reset) {
        setContacts(data.contacts)
        setOffset(0)
      } else {
        setContacts(prev => [...prev, ...data.contacts])
      }
      setTotal(data.total)
    }
    setLoading(false)
  }, [stageFilter, tierFilter, query, offset])

  useEffect(() => { void load(true) }, [stageFilter, tierFilter]) // eslint-disable-line

  async function openContact(c: MarketContact) {
    setSelected(c)
    setEditNotes(c.notes ?? '')
    setEditFollowUp(c.next_follow_up ?? '')
    setTouchLoading(true)
    const r = await fetch(`/api/marketing/touches?contact_id=${c.id}`, { credentials: 'include' })
    setTouches(r.ok ? await r.json() : [])
    setTouchLoading(false)
  }

  async function saveContact() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/marketing/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: selected.id, notes: editNotes, next_follow_up: editFollowUp }),
    })
    setSaving(false)
  }

  async function updateStage(c: MarketContact, stage: string) {
    await fetch('/api/marketing/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: c.id, stage }),
    })
    setContacts(prev => prev.map(x => x.id === c.id ? { ...x, stage } : x))
    if (selected?.id === c.id) setSelected(prev => prev ? { ...prev, stage } : prev)
  }

  async function logTouch() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/marketing/touches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ contact_id: selected.id, ...logForm }),
    })
    // Reload touches
    const r = await fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' })
    setTouches(r.ok ? await r.json() : [])
    if (logForm.new_stage) {
      setContacts(prev => prev.map(x => x.id === selected.id ? { ...x, stage: logForm.new_stage } : x))
      setSelected(prev => prev ? { ...prev, stage: logForm.new_stage, last_touch_at: new Date().toISOString() } : prev)
    } else {
      setSelected(prev => prev ? { ...prev, last_touch_at: new Date().toISOString() } : prev)
    }
    setLogForm({ channel: 'phone', direction: 'outbound', notes: '', new_stage: '' })
    setLogOpen(false)
    setSaving(false)
  }

  return (
    <div className="crm-shell flex gap-0 overflow-hidden" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Left panel — contact list */}
      <div className="flex w-full flex-col md:w-[420px] md:shrink-0 border-r border-slate-100">
        {/* Filters */}
        <div className="border-b border-slate-100 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-bold text-[#1a2744]">Partner Pipeline</h1>
            <span className="text-xs text-slate-400">{total.toLocaleString()} contacts</span>
          </div>

          <input
            type="text"
            placeholder="Search name, company, city..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(true)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#1a2744]"
          />

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setStageFilter('')}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${!stageFilter ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              All
            </button>
            {STAGES.slice(0, 6).map(s => (
              <button
                key={s}
                onClick={() => setStageFilter(stageFilter === s ? '' : s)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${stageFilter === s ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto">
            <button onClick={() => setTierFilter('')} className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold transition ${!tierFilter ? 'bg-[#1a2744] text-[#f5a623]' : 'bg-slate-100 text-slate-600'}`}>All tiers</button>
            {TIERS.map(t => (
              <button key={t} onClick={() => setTierFilter(tierFilter === t ? '' : t)} className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold transition ${tierFilter === t ? 'bg-[#1a2744] text-[#f5a623]' : 'bg-slate-100 text-slate-600'}`}>Tier {t}</button>
            ))}
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {loading && contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading...</div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">No contacts found.</div>
          ) : contacts.map(c => {
            const days = daysSince(c.last_touch_at)
            const isSelected = selected?.id === c.id
            return (
              <button
                key={c.id}
                onClick={() => void openContact(c)}
                className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${isSelected ? 'bg-slate-50 border-l-2 border-[#1a2744]' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="truncate text-xs text-slate-500">{c.company || c.industry}</div>
                    <div className="text-xs text-slate-400">{c.city}</div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_COLORS[c.stage] ?? 'bg-slate-100 text-slate-600'}`}>
                      {STAGE_LABELS[c.stage]}
                    </span>
                    {days !== null && (
                      <span className={`text-[10px] ${days > 14 ? 'text-rose-500' : 'text-slate-400'}`}>
                        {days === 0 ? 'today' : `${days}d ago`}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
          {contacts.length < total && !loading && (
            <button
              onClick={() => { setOffset(contacts.length); void load() }}
              className="w-full py-4 text-xs font-medium text-[#1a2744] hover:bg-slate-50"
            >
              Load more ({total - contacts.length} remaining)
            </button>
          )}
        </div>
      </div>

      {/* Right panel — contact detail */}
      <div className="hidden flex-1 flex-col overflow-y-auto md:flex">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-4xl">👥</div>
            <div className="font-semibold text-[#1a2744]">Select a contact</div>
            <div className="text-sm text-slate-400">Click any name on the left to view their profile and log interactions.</div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Contact header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#1a2744] text-base font-bold text-[#f5a623]">
                  {selected.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#1a2744]">{selected.name}</h2>
                  {selected.title && <div className="text-sm text-slate-500">{selected.title}</div>}
                  {selected.company && <div className="text-sm font-medium text-slate-700">{selected.company}</div>}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                    {selected.city && <span>📍 {selected.city}</span>}
                    {selected.phone && <a href={`tel:${selected.phone}`} className="hover:text-[#1a2744]">📞 {selected.phone}</a>}
                    {selected.email && <a href={`mailto:${selected.email}`} className="hover:text-[#1a2744]">📧 {selected.email}</a>}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${STAGE_COLORS[selected.stage]}`}>
                  {STAGE_LABELS[selected.stage]}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  Tier {selected.tier} · {selected.tracking_code}
                </span>
              </div>
            </div>

            {/* Move stage */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Move Stage</div>
              <div className="flex flex-wrap gap-2">
                {STAGES.filter(s => s !== 'dnc').map(s => (
                  <button
                    key={s}
                    onClick={() => void updateStage(selected, s)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${selected.stage === s ? STAGE_COLORS[s] + ' ring-2 ring-offset-1 ring-[#1a2744]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Log touch */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Activity</div>
                <button onClick={() => setLogOpen(true)} className="rounded-lg bg-[#1a2744] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90">
                  + Log Touch
                </button>
              </div>

              {logOpen && (
                <div className="mb-4 rounded-xl border border-[#1a2744]/20 bg-[#1a2744]/5 p-4 space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {CHANNELS.map(ch => (
                      <button key={ch} onClick={() => setLogForm(f => ({ ...f, channel: ch }))} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${logForm.channel === ch ? 'bg-[#1a2744] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                        {CHANNEL_ICONS[ch]} {ch.replace('_',' ')}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    {['outbound','inbound'].map(d => (
                      <button key={d} onClick={() => setLogForm(f => ({ ...f, direction: d }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${logForm.direction === d ? 'bg-[#1a2744] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                        {d === 'inbound' ? '← Inbound' : '→ Outbound'}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="crm-input h-16 resize-none text-xs"
                    placeholder="What happened? What did they say?"
                    value={logForm.notes}
                    onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                  />
                  <div className="flex items-center gap-2">
                    <select className="crm-input text-xs flex-1" value={logForm.new_stage} onChange={e => setLogForm(f => ({ ...f, new_stage: e.target.value }))}>
                      <option value="">Keep current stage</option>
                      {STAGES.map(s => <option key={s} value={s}>→ Move to {STAGE_LABELS[s]}</option>)}
                    </select>
                    <button onClick={() => void logTouch()} disabled={saving} className="rounded-lg bg-[#f5a623] px-4 py-2 text-xs font-bold text-[#1a2744] hover:opacity-90 disabled:opacity-60">
                      {saving ? '...' : 'Save'}
                    </button>
                    <button onClick={() => setLogOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">✕</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {touchLoading ? (
                  <div className="text-xs text-slate-400 py-2">Loading history...</div>
                ) : touches.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No touches logged yet. Log your first interaction above.</div>
                ) : touches.map(t => (
                  <div key={t.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
                    <span className="text-base">{CHANNEL_ICONS[t.channel] ?? '📋'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold capitalize text-[#1a2744]">{t.channel.replace('_',' ')}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${t.direction === 'inbound' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                          {t.direction}
                        </span>
                        <span className="text-slate-400">{new Date(t.created_at).toLocaleDateString('en-CA')}</span>
                        {t.created_by && <span className="text-slate-400">· {t.created_by}</span>}
                      </div>
                      {t.notes && <div className="mt-1 text-xs text-slate-600">{t.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes + follow-up */}
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="crm-label">Notes</span>
                <textarea
                  className="crm-input mt-1 h-24 resize-none text-sm"
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Relationship notes, preferences, context..."
                />
              </label>
              <label className="block">
                <span className="crm-label">Next Follow-up</span>
                <input
                  type="date"
                  className="crm-input mt-1"
                  value={editFollowUp}
                  onChange={e => setEditFollowUp(e.target.value)}
                />
                {selected.website && (
                  <a href={selected.website} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-1 text-xs text-[#1a2744] underline underline-offset-2">
                    🌐 {selected.website.replace(/https?:\/\//,'')}
                  </a>
                )}
              </label>
            </div>
            <button onClick={() => void saveContact()} disabled={saving} className="crm-button-dark text-sm disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="crm-shell p-16 text-center text-sm text-slate-400">Loading...</div>}>
      <PartnersInner />
    </Suspense>
  )
}
