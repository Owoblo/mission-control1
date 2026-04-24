'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Batch {
  id: string
  name: string
  industry: string | null
  city: string | null
  status: string
  sequence_type: string
  mail_sent_date: string | null
  email_delay_days: number
  sms_delay_days: number
  rep_name: string
  partnership_phone: string
  tracking_code: string | null
  notes: string | null
  created_at: string
  total_contacts: number
  responded_count: number
  engaged_count: number
  partner_count: number
}

interface Contact {
  id: string
  name: string
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  city: string | null
  industry: string | null
  stage: string | null
  pipeline_phase: string | null
  decision: string | null
  sequence_step: number
  sequence_paused: boolean
  sequence_paused_reason: string | null
  next_follow_up: string | null
  last_touch_at: string | null
  email_scheduled_at: string | null
  sms_scheduled_at: string | null
  batch_id: string | null
  touch_count: number
  needs_follow_up: boolean
  normalized_stage: string
}

interface Touch {
  id: string
  channel: string
  direction: string
  notes: string
  created_by: string
  created_at: string
  outcome_code?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysAgo(d?: string | null) {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function daysUntil(d?: string | null) {
  if (!d) return null
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000)
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

const STAGE_BADGE: Record<string, string> = {
  target:             'bg-slate-100 text-slate-600',
  mail_sent:          'bg-amber-100 text-amber-700',
  follow_up_due:      'bg-rose-100 text-rose-700',
  attempting_contact: 'bg-sky-100 text-sky-700',
  connected:          'bg-violet-100 text-violet-700',
  qualified:          'bg-orange-100 text-orange-700',
  partnership_active: 'bg-emerald-100 text-emerald-700',
  dormant:            'bg-fuchsia-100 text-fuchsia-700',
  closed_lost:        'bg-zinc-100 text-zinc-600',
}

const STAGE_LABEL: Record<string, string> = {
  target: 'Targeted', mail_sent: 'Mailed', follow_up_due: 'Follow-up Due',
  attempting_contact: 'Attempting', connected: 'Connected', qualified: 'Qualified',
  partnership_active: 'Partner', dormant: 'Dormant', closed_lost: 'Closed',
}

const CHANNEL_ICON: Record<string, string> = {
  direct_mail: '📬', email: '✉️', sms: '💬', phone: '📞', linkedin: '🔗', in_person: '🤝',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STAGE_BADGE[stage] ?? 'bg-slate-100 text-slate-600'}`}>
      {STAGE_LABEL[stage] ?? stage}
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#1a2744]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  )
}

// ─── Decision Modal ───────────────────────────────────────────────────────────

function DecisionModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const [decision, setDecision] = useState<'agreed' | 'indifferent' | 'rejected' | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!decision) return
    setSaving(true)
    await fetch(`/api/marketing/contacts/${contact.id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ decision, notes }),
    })
    setSaving(false)
    onDone()
  }

  const options = [
    { key: 'agreed', label: 'Agreed to Partner', desc: 'They said yes — moves to Active Partners', color: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    { key: 'indifferent', label: 'Open but Undecided', desc: 'Nurture them — 30-day cycle continues', color: 'border-amber-300 bg-amber-50 text-amber-800' },
    { key: 'rejected', label: 'Not Interested', desc: 'Remove from outreach, close the loop', color: 'border-rose-300 bg-rose-50 text-rose-800' },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-[#1a2744]">Log Decision</h3>
        <p className="mt-1 text-sm text-slate-500">{contact.name} · {contact.company ?? contact.industry ?? ''}</p>

        <div className="mt-4 space-y-2">
          {options.map(opt => (
            <button
              key={opt.key}
              onClick={() => setDecision(opt.key)}
              className={`w-full rounded-[18px] border-2 p-4 text-left transition ${decision === opt.key ? opt.color : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
            >
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="mt-0.5 text-xs opacity-70">{opt.desc}</div>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold text-slate-500">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What was said? Any context for future reference..."
            className="mt-1 h-24 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!decision || saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving...' : 'Log Decision'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Contact Drawer ───────────────────────────────────────────────────────────

function ContactDrawer({ contact, onClose, onDecision }: {
  contact: Contact
  onClose: () => void
  onDecision: () => void
}) {
  const [touches, setTouches] = useState<Touch[]>([])
  const [loading, setLoading] = useState(true)
  const [showDecision, setShowDecision] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const r = await fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' })
      setTouches(r.ok ? await r.json() : [])
      setLoading(false)
    }
    void load()
  }, [contact.id])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-semibold text-[#1a2744]">{contact.name}</div>
              <div className="text-sm text-slate-500">{contact.company ?? contact.industry ?? 'No company'}</div>
            </div>
            <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StageBadge stage={contact.normalized_stage} />
            {contact.sequence_paused && (
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">Responded</span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Contact info */}
          <div className="rounded-[18px] border border-slate-100 bg-slate-50 p-4 space-y-2">
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-slate-700 hover:text-[#1a2744]">
                <span className="text-base">📞</span> {contact.phone}
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-slate-700 hover:text-[#1a2744]">
                <span className="text-base">✉️</span> {contact.email}
              </a>
            )}
            {contact.city && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="text-base">📍</span> {contact.city}
              </div>
            )}
          </div>

          {/* Sequence status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Email Scheduled</div>
              <div className="mt-1 text-sm font-semibold text-[#1a2744]">{fmtDate(contact.email_scheduled_at)}</div>
            </div>
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">SMS Scheduled</div>
              <div className="mt-1 text-sm font-semibold text-[#1a2744]">{fmtDate(contact.sms_scheduled_at)}</div>
            </div>
          </div>

          {/* Decision button — only for responded contacts */}
          {contact.sequence_paused && !contact.decision && (
            <button
              onClick={() => setShowDecision(true)}
              className="w-full rounded-[18px] border-2 border-[#1a2744] bg-[#1a2744] py-3 text-sm font-semibold text-white hover:bg-[#243560]"
            >
              Log Decision
            </button>
          )}

          {contact.decision && (
            <div className={`rounded-[18px] border p-3 text-center text-sm font-semibold ${
              contact.decision === 'agreed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
              contact.decision === 'rejected' ? 'border-rose-200 bg-rose-50 text-rose-700' :
              'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              Decision: {contact.decision.charAt(0).toUpperCase() + contact.decision.slice(1)}
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">Timeline</div>
            <div className="mt-3 space-y-3">
              {loading ? (
                <div className="text-sm text-slate-400">Loading...</div>
              ) : touches.length === 0 ? (
                <div className="text-sm text-slate-400">No touches yet.</div>
              ) : touches.map(t => (
                <div key={t.id} className="rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span>{CHANNEL_ICON[t.channel] ?? '•'}</span>
                      {t.channel.replace('_', ' ')}
                      {t.direction === 'inbound' && <span className="text-violet-600">← inbound</span>}
                    </div>
                    <span className="text-[11px] text-slate-400">{fmtDate(t.created_at)}</span>
                  </div>
                  {t.notes && <div className="mt-1.5 text-xs text-slate-600">{t.notes}</div>}
                  <div className="mt-1 text-[10px] text-slate-400">{t.created_by}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showDecision && (
        <DecisionModal
          contact={contact}
          onClose={() => setShowDecision(false)}
          onDone={() => { setShowDecision(false); onDecision() }}
        />
      )}
    </>
  )
}

// ─── Tab 1: Today's Actions ───────────────────────────────────────────────────

function TodayActions({ contacts, loading, onSelect, onRefresh }: {
  contacts: Contact[]
  loading: boolean
  onSelect: (c: Contact) => void
  onRefresh: () => void
}) {
  const [decisionContact, setDecisionContact] = useState<Contact | null>(null)
  const responded = contacts.filter(c => c.sequence_paused && !c.decision)
  const overdue = contacts.filter(c => !c.sequence_paused && c.needs_follow_up)

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Need Decision" value={responded.length} sub="responded, awaiting rep" />
        <Stat label="Follow-up Overdue" value={overdue.length} sub="past due date" />
        <Stat label="In Sequence" value={contacts.filter(c => !c.sequence_paused && !c.decision).length} sub="automated running" />
        <Stat label="Partners Won" value={contacts.filter(c => c.decision === 'agreed').length} sub="this pipeline" />
      </div>

      {/* Responded — need a human decision */}
      {responded.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-violet-500" />
            <h2 className="text-sm font-semibold text-[#1a2744]">Responded — Need Your Decision</h2>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{responded.length}</span>
          </div>
          <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
            {responded.map((c, i) => (
              <div key={c.id} className={`flex items-center gap-4 px-5 py-4 ${i < responded.length - 1 ? 'border-b border-slate-100' : ''}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#1a2744]">{c.name}</span>
                    <StageBadge stage={c.normalized_stage} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {c.company ?? c.industry ?? 'No company'}
                    {c.city ? ` · ${c.city}` : ''}
                    {c.last_touch_at ? ` · last touch ${fmtDate(c.last_touch_at)}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744]">
                      Call
                    </a>
                  )}
                  <button
                    onClick={() => setDecisionContact(c)}
                    className="rounded-lg bg-[#1a2744] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Log Decision
                  </button>
                  <button onClick={() => onSelect(c)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overdue follow-ups */}
      {overdue.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-rose-500" />
            <h2 className="text-sm font-semibold text-[#1a2744]">Overdue Follow-ups</h2>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{overdue.length}</span>
          </div>
          <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
            {overdue.map((c, i) => {
              const days = daysUntil(c.next_follow_up)
              return (
                <div key={c.id} className={`flex items-center gap-4 px-5 py-4 ${i < overdue.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-semibold text-rose-600">
                    {c.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#1a2744]">{c.name}</span>
                      <StageBadge stage={c.normalized_stage} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {c.company ?? c.industry ?? 'No company'}
                      {c.city ? ` · ${c.city}` : ''}
                      {days !== null && <span className="font-medium text-rose-500"> · {Math.abs(days)}d overdue</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744]">
                        Call
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744]">
                        Email
                      </a>
                    )}
                    <button onClick={() => onSelect(c)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                      View
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && responded.length === 0 && overdue.length === 0 && (
        <div className="rounded-[24px] border border-slate-200 bg-white p-16 text-center">
          <div className="text-3xl">✓</div>
          <div className="mt-3 text-base font-semibold text-[#1a2744]">All clear</div>
          <div className="mt-1 text-sm text-slate-500">No actions needed right now. The sequence is running.</div>
        </div>
      )}

      {decisionContact && (
        <DecisionModal
          contact={decisionContact}
          onClose={() => setDecisionContact(null)}
          onDone={() => { setDecisionContact(null); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

function CsvImportModal({ batch, onClose, onDone }: {
  batch: Batch
  onClose: () => void
  onDone: (inserted: number) => void
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const FIELDS = ['name', 'company', 'title', 'email', 'phone', 'address', 'city', 'industry', 'website']

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      if (parsed.length === 0) { setError('Could not parse CSV. Check file format.'); return }
      const cols = Object.keys(parsed[0])
      setHeaders(cols)
      setRows(parsed)
      setError(null)
      // Auto-map obvious columns
      const autoMap: Record<string, string> = {}
      for (const field of FIELDS) {
        const match = cols.find(c => c.toLowerCase().includes(field) || field.includes(c.toLowerCase()))
        if (match) autoMap[field] = match
      }
      setMapping(autoMap)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (!mapping.name) { setError('Name column is required.'); return }
    setImporting(true)
    setError(null)
    const contacts = rows.map(row => {
      const c: Record<string, string> = {}
      for (const [field, col] of Object.entries(mapping)) {
        if (col) c[field] = row[col] ?? ''
      }
      return c
    })
    const res = await fetch('/api/marketing/contacts/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ batch_id: batch.id, contacts }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) {
      setError(data.error ?? 'Import failed')
      setImporting(false)
      return
    }
    onDone(data.inserted)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#1a2744]">Import Contacts</h3>
            <p className="mt-0.5 text-sm text-slate-500">Batch: {batch.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <div
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-[18px] border-2 border-dashed border-slate-300 p-10 text-center hover:border-[#1a2744]"
            >
              <div className="text-2xl text-slate-400">📄</div>
              <div className="mt-2 text-sm font-medium text-slate-600">Click to upload CSV file</div>
              <div className="mt-1 text-xs text-slate-400">Headers should include: Name, Email, Phone, Company, etc.</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
              {rows.length} rows detected · Map your columns below
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(field => (
                <div key={field}>
                  <label className="text-xs font-semibold text-slate-500 capitalize">{field} {field === 'name' ? '*' : ''}</label>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                    className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
                  >
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-400 mb-2">Preview (first 3 rows)</div>
              {rows.slice(0, 3).map((row, i) => (
                <div key={i} className="text-xs text-slate-600 truncate">{mapping.name ? row[mapping.name] : '—'} · {mapping.email ? row[mapping.email] : '—'} · {mapping.company ? row[mapping.company] : '—'}</div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          {rows.length > 0 && (
            <button onClick={doImport} disabled={importing || !mapping.name} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {importing ? 'Importing...' : `Import ${rows.length} Contacts`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── New Batch Modal ──────────────────────────────────────────────────────────

function NewBatchModal({ onClose, onDone }: { onClose: () => void; onDone: (batch: Batch) => void }) {
  const [form, setForm] = useState({
    name: '', industry: '', city: '',
    sequence_type: 'standard',
    email_delay_days: 7,
    sms_delay_days: 5,
    rep_name: 'Eric',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Batch name required'); return }
    setSaving(true)
    const res = await fetch('/api/marketing/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone(data.batch)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">New Batch</h3>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Batch Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Windsor Realtors – Batch 1" required className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Industry</label>
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Realtors" className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">City</label>
              <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Windsor" className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Sequence Type</label>
            <select value={form.sequence_type} onChange={e => set('sequence_type', e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
              <option value="standard">Standard (Mail → Email → SMS)</option>
              <option value="corporate">Corporate (Mail → Email → LinkedIn)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Email delay (days after mail)</label>
              <input type="number" min={1} max={30} value={form.email_delay_days} onChange={e => set('email_delay_days', Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">SMS delay (days after email)</label>
              <input type="number" min={1} max={30} value={form.sms_delay_days} onChange={e => set('sms_delay_days', Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Rep Name</label>
            <input value={form.rep_name} onChange={e => set('rep_name', e.target.value)} placeholder="Eric" className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating...' : 'Create Batch'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mark as Mailed Modal ─────────────────────────────────────────────────────

function MarkMailedModal({ batch, onClose, onDone }: {
  batch: Batch
  onClose: () => void
  onDone: (result: { email_date: string; secondary_date: string; scheduled: number }) => void
}) {
  const [mailDate, setMailDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    const res = await fetch(`/api/marketing/batches/${batch.id}/mark-mailed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ mail_date: mailDate }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone(data)
  }

  const emailDays = batch.email_delay_days ?? 7
  const smsDays = batch.sms_delay_days ?? 5
  const emailDate = new Date(mailDate + 'T12:00:00Z')
  emailDate.setDate(emailDate.getDate() + emailDays)
  const smsDate = new Date(emailDate)
  smsDate.setDate(smsDate.getDate() + smsDays)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Mark Batch as Mailed</h3>
        <p className="mt-1 text-sm text-slate-500">{batch.name}</p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Date Mail Was Sent</label>
            <input
              type="date"
              value={mailDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setMailDate(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]"
            />
            <p className="mt-1 text-[11px] text-slate-400">You can set a past date if you mailed it earlier this week.</p>
          </div>

          <div className="rounded-[18px] border border-slate-100 bg-slate-50 p-4 space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Sequence will fire:</div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">✉️ Email follow-up</span>
              <span className="font-semibold text-[#1a2744]">{emailDate.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{batch.sequence_type === 'corporate' ? '🔗 LinkedIn' : '💬 SMS'} nudge</span>
              <span className="font-semibold text-[#1a2744]">{smsDate.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
        </div>

        {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Scheduling...' : 'Start Sequence'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 3: Batch Manager ─────────────────────────────────────────────────────

function BatchManager({ batches, loading, onRefresh }: {
  batches: Batch[]
  loading: boolean
  onRefresh: () => void
}) {
  const [newBatch, setNewBatch] = useState(false)
  const [csvBatch, setCsvBatch] = useState<Batch | null>(null)
  const [mailedBatch, setMailedBatch] = useState<Batch | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1a2744]">Batch Manager</h2>
          <p className="text-sm text-slate-500">Create batches, upload contacts, trigger sequences.</p>
        </div>
        <button onClick={() => setNewBatch(true)} className="rounded-xl bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243560]">
          + New Batch
        </button>
      </div>

      {loading ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">Loading batches...</div>
      ) : batches.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-12 text-center">
          <div className="text-3xl">📦</div>
          <div className="mt-3 text-base font-semibold text-[#1a2744]">No batches yet</div>
          <div className="mt-1 text-sm text-slate-500">Create your first batch, upload your cleaned list, then mark it as mailed.</div>
          <button onClick={() => setNewBatch(true)} className="mt-4 rounded-xl bg-[#1a2744] px-5 py-2.5 text-sm font-semibold text-white">Create First Batch</button>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map(batch => {
            const mailed = !!batch.mail_sent_date
            const responseRate = batch.total_contacts > 0
              ? Math.round((batch.responded_count / batch.total_contacts) * 100)
              : 0

            return (
              <div key={batch.id} className="rounded-[22px] border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#1a2744]">{batch.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${batch.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {batch.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-2">
                      {batch.industry && <span>{batch.industry}</span>}
                      {batch.city && <span>· {batch.city}</span>}
                      <span>· {batch.sequence_type === 'corporate' ? 'Mail → Email → LinkedIn' : 'Mail → Email → SMS'}</span>
                      <span>· Rep: {batch.rep_name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!mailed && batch.total_contacts > 0 && (
                      <button
                        onClick={() => setMailedBatch(batch)}
                        className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        Mark as Mailed
                      </button>
                    )}
                    <button
                      onClick={() => setCsvBatch(batch)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Upload CSV
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-center">
                    <div className="text-xl font-semibold text-[#1a2744]">{batch.total_contacts}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Contacts</div>
                  </div>
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-center">
                    <div className="text-xl font-semibold text-violet-600">{batch.responded_count}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Responded</div>
                  </div>
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-center">
                    <div className="text-xl font-semibold text-emerald-600">{batch.partner_count}</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Partners</div>
                  </div>
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-center">
                    <div className="text-xl font-semibold text-[#1a2744]">{responseRate}%</div>
                    <div className="text-[10px] text-slate-400 uppercase tracking-wide">Response Rate</div>
                  </div>
                </div>

                {mailed && (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>📬 Mailed {fmtDateTime(batch.mail_sent_date)}</span>
                    <span>✉️ Email +{batch.email_delay_days}d</span>
                    <span>{batch.sequence_type === 'corporate' ? '🔗' : '💬'} {batch.sequence_type === 'corporate' ? 'LinkedIn' : 'SMS'} +{batch.email_delay_days + batch.sms_delay_days}d</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {newBatch && (
        <NewBatchModal
          onClose={() => setNewBatch(false)}
          onDone={batch => { setNewBatch(false); showToast(`Batch "${batch.name}" created`); onRefresh() }}
        />
      )}

      {csvBatch && (
        <CsvImportModal
          batch={csvBatch}
          onClose={() => setCsvBatch(null)}
          onDone={n => { setCsvBatch(null); showToast(`${n} contacts imported`); onRefresh() }}
        />
      )}

      {mailedBatch && (
        <MarkMailedModal
          batch={mailedBatch}
          onClose={() => setMailedBatch(null)}
          onDone={result => {
            setMailedBatch(null)
            showToast(`Sequence started for ${result.scheduled} contacts — email ${result.email_date}, ${result.secondary_date} for follow-up`)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ─── Tab 2: Pipeline ──────────────────────────────────────────────────────────

const PIPELINE_COLS = [
  { key: 'connected',          label: 'Engaged',     color: 'bg-violet-50 border-violet-200' },
  { key: 'qualified',          label: 'Spoke / Qualified', color: 'bg-orange-50 border-orange-200' },
  { key: 'partnership_active', label: 'Active Partner', color: 'bg-emerald-50 border-emerald-200' },
  { key: 'dormant',            label: 'Nurture',     color: 'bg-fuchsia-50 border-fuchsia-200' },
]

function PipelineView({ contacts, onSelect }: { contacts: Contact[]; onSelect: (c: Contact) => void }) {
  const responded = contacts.filter(c => c.sequence_paused)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[#1a2744]">Relationship Pipeline</h2>
        <p className="text-sm text-slate-500">Contacts who responded — manage them to a decision.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_COLS.map(col => {
          const colContacts = responded.filter(c => c.normalized_stage === col.key)
          return (
            <div key={col.key} className={`rounded-[22px] border p-4 ${col.color}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">{col.label}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{colContacts.length}</span>
              </div>
              <div className="space-y-2">
                {colContacts.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-slate-200 bg-white/50 p-4 text-center text-xs text-slate-400">Empty</div>
                ) : colContacts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c)}
                    className="w-full rounded-[16px] border border-white bg-white p-3 text-left shadow-sm hover:shadow-md transition"
                  >
                    <div className="text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                    <div className="mt-2 text-[11px] text-slate-400">{c.city ?? ''} {c.last_touch_at ? `· ${fmtDate(c.last_touch_at)}` : ''}</div>
                    {c.decision && (
                      <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.decision === 'agreed' ? 'bg-emerald-100 text-emerald-700' : c.decision === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.decision}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab 4: Maintenance ───────────────────────────────────────────────────────

function MaintenanceView({ contacts, onSelect }: { contacts: Contact[]; onSelect: (c: Contact) => void }) {
  const partners = contacts.filter(c => c.decision === 'agreed' || c.normalized_stage === 'partnership_active')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[#1a2744]">Active Partners</h2>
        <p className="text-sm text-slate-500">Partners you've won. Keep the relationship warm month on month.</p>
      </div>
      {partners.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200 bg-white p-12 text-center">
          <div className="text-3xl">🤝</div>
          <div className="mt-3 text-base font-semibold text-[#1a2744]">No active partners yet</div>
          <div className="mt-1 text-sm text-slate-500">Once you log a decision of "Agreed", they appear here.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {partners.map(c => {
            const days = daysAgo(c.last_touch_at)
            return (
              <button key={c.id} onClick={() => onSelect(c)} className="rounded-[22px] border border-slate-200 bg-white p-5 text-left hover:shadow-md transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {c.name.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.company ?? c.industry ?? ''}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-[10px] bg-slate-50 p-2">
                    <div className="text-slate-400">City</div>
                    <div className="font-semibold text-[#1a2744]">{c.city ?? '—'}</div>
                  </div>
                  <div className="rounded-[10px] bg-slate-50 p-2">
                    <div className="text-slate-400">Last touch</div>
                    <div className={`font-semibold ${days !== null && days > 30 ? 'text-rose-600' : 'text-[#1a2744]'}`}>
                      {days !== null ? `${days}d ago` : '—'}
                    </div>
                  </div>
                </div>
                {c.phone && (
                  <div className="mt-3 flex gap-2">
                    <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-medium text-slate-600 hover:border-[#1a2744]">
                      Call
                    </a>
                    {c.email && (
                      <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} className="flex-1 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-medium text-slate-600 hover:border-[#1a2744]">
                        Email
                      </a>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'today',       label: "Today's Actions" },
  { key: 'pipeline',    label: 'Pipeline' },
  { key: 'batches',     label: 'Batches' },
  { key: 'maintenance', label: 'Partners' },
] as const

type Tab = typeof TABS[number]['key']

function PartnershipEngineInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'today')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const r = await fetch('/api/marketing/contacts?limit=500&offset=0', { credentials: 'include' })
    if (r.ok) {
      const data = await r.json()
      setContacts(data.contacts ?? [])
    }
    setContactsLoading(false)
  }, [])

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true)
    const r = await fetch('/api/marketing/batches', { credentials: 'include' })
    if (r.ok) setBatches(await r.json())
    setBatchesLoading(false)
  }, [])

  useEffect(() => {
    void loadContacts()
    void loadBatches()
  }, [loadContacts, loadBatches])

  function handleTabChange(t: Tab) {
    setTab(t)
    router.replace(`/marketing/partners?tab=${t}`, { scroll: false })
  }

  const responded = contacts.filter(c => c.sequence_paused && !c.decision).length

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-[22px] border border-slate-200 bg-white p-1.5 shadow-sm">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`relative shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${tab === t.key ? 'bg-[#1a2744] text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-[#1a2744]'}`}
          >
            {t.label}
            {t.key === 'today' && responded > 0 && (
              <span className={`ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${tab === 'today' ? 'bg-white text-[#1a2744]' : 'bg-rose-500 text-white'}`}>
                {responded}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'today' && (
        <TodayActions
          contacts={contacts}
          loading={contactsLoading}
          onSelect={setSelectedContact}
          onRefresh={() => void loadContacts()}
        />
      )}
      {tab === 'pipeline' && (
        <PipelineView contacts={contacts} onSelect={setSelectedContact} />
      )}
      {tab === 'batches' && (
        <BatchManager
          batches={batches}
          loading={batchesLoading}
          onRefresh={() => { void loadBatches(); void loadContacts() }}
        />
      )}
      {tab === 'maintenance' && (
        <MaintenanceView contacts={contacts} onSelect={setSelectedContact} />
      )}

      {/* Contact drawer */}
      {selectedContact && (
        <ContactDrawer
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onDecision={() => { setSelectedContact(null); void loadContacts() }}
        />
      )}
    </div>
  )
}

export default function PartnershipEnginePage() {
  return (
    <Suspense fallback={
      <div className="rounded-[24px] border border-slate-200 bg-white p-16 text-center text-sm text-slate-400">
        Loading Partnership Engine...
      </div>
    }>
      <PartnershipEngineInner />
    </Suspense>
  )
}
