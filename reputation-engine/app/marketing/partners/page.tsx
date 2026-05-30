'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PARTNERSHIP_STAGE_META } from '@/lib/marketing'
import { sendSalesMessage } from '@/lib/sales-api'

// ─── Types ───────────────────────────────────────────────────────────────────

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
  latest_touch_channel?: string | null
  latest_touch_direction?: string | null
  latest_touch_note?: string | null
  latest_inbound_at?: string | null
  latest_inbound_note?: string | null
}

interface Touch {
  id: string
  channel: string
  direction: string
  notes: string | null
  created_at: string
  outcome_code: string | null
  next_step: string | null
  new_stage: string | null
  metadata: Record<string, unknown> | null
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(d?: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function daysUntil(d?: string | null) {
  if (!d) return null
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
  return diff
}

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim())
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

function timeAgo(d?: string | null) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

function truncateText(value: string, max = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1).trimEnd()}…`
}

function unwrapAutoTouch(value: string, prefix: 'Auto-SMS sent:' | 'Auto-email sent:') {
  return value.replace(prefix, '').trim().replace(/^"/, '').replace(/"$/, '')
}

function summarizeTouch(channel: string, direction?: string | null, notes?: string | null) {
  const text = (notes || '').trim()

  if (text.startsWith('Auto-SMS sent:')) {
    return { label: 'Automated SMS', body: unwrapAutoTouch(text, 'Auto-SMS sent:'), automated: true }
  }
  if (text.startsWith('Auto-email sent:')) {
    return { label: 'Automated Email', body: unwrapAutoTouch(text, 'Auto-email sent:'), automated: true }
  }
  if (text.startsWith('Inbound SMS:')) {
    return { label: 'Inbound SMS', body: text.replace(/^Inbound SMS:\s*/, '') }
  }
  if (text.startsWith('Inbound email:')) {
    return { label: 'Inbound Email', body: text.replace(/^Inbound email:\s*/, '') }
  }
  if (channel === 'direct_mail') {
    return { label: 'Direct Mail', body: text || 'Direct mail sent' }
  }
  if (channel === 'phone' || channel === 'call') {
    return { label: direction === 'inbound' ? 'Inbound Call' : 'Call', body: text || 'Call logged' }
  }
  if (channel === 'email') {
    return { label: direction === 'inbound' ? 'Inbound Email' : 'Email Sent', body: text || 'Email sent' }
  }
  if (channel === 'sms') {
    return { label: direction === 'inbound' ? 'Inbound SMS' : 'SMS Sent', body: text || 'SMS sent' }
  }
  if (channel === 'linkedin') {
    return { label: 'LinkedIn', body: text || 'LinkedIn follow-up queued' }
  }
  if (channel === 'note') {
    return { label: direction === 'internal' ? 'Internal Note' : 'Note', body: text || 'Note saved' }
  }

  return { label: channel.replace(/_/g, ' '), body: text }
}

function getContactPreview(contact: Contact) {
  if (contact.latest_inbound_note) {
    return summarizeTouch(contact.latest_touch_channel || 'sms', 'inbound', contact.latest_inbound_note)
  }
  if (contact.latest_touch_note) {
    return summarizeTouch(contact.latest_touch_channel || 'note', contact.latest_touch_direction, contact.latest_touch_note)
  }
  return null
}

// ─── Small components ─────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const meta = PARTNERSHIP_STAGE_META[stage as keyof typeof PARTNERSHIP_STAGE_META]
  if (!meta) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">{stage}</span>
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
}

function ChannelIcon({ channel, direction }: { channel: string; direction?: string }) {
  const inbound = direction === 'inbound'
  if (channel === 'call' || channel === 'phone') return <span title={inbound ? 'Incoming call' : 'Outgoing call'}>{inbound ? '📲' : '📞'}</span>
  if (channel === 'sms') return <span title={inbound ? 'Inbound SMS' : 'Sent SMS'}>{inbound ? '💬' : '💬'}</span>
  if (channel === 'email') return <span title={inbound ? 'Email reply' : 'Email sent'}>✉️</span>
  if (channel === 'direct_mail') return <span title="Direct mail">📬</span>
  if (channel === 'linkedin') return <span title="LinkedIn">🔗</span>
  if (channel === 'note') return <span>📝</span>
  if (channel === 'visit') return <span>🤝</span>
  return <span>📌</span>
}

// ─── Decision Modal ───────────────────────────────────────────────────────────

function DecisionModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const [decision, setDecision] = useState<'agreed' | 'rejected' | 'thinking'>('agreed')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    await fetch('/api/marketing/touches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'note',
        direction: 'internal',
        notes: `Decision: ${decision}. ${notes}`.trim(),
        outcome_code: decision,
        new_stage: decision === 'agreed' ? 'partnership_active' : decision === 'rejected' ? 'dormant' : 'qualified',
      }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Log Decision</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {(['agreed', 'thinking', 'rejected'] as const).map(d => (
            <button key={d} onClick={() => setDecision(d)}
              className={`rounded-[14px] border py-3 text-sm font-semibold capitalize transition ${decision === d ? 'border-[#1a2744] bg-[#1a2744] text-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#1a2744]'}`}>
              {d === 'agreed' ? '✅ Won' : d === 'thinking' ? '🤔 Thinking' : '❌ Pass'}
            </button>
          ))}
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)…"
          className="mt-4 h-20 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Log Decision'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── New Batch Modal ──────────────────────────────────────────────────────────

function NewBatchModal({ onClose, onDone }: { onClose: () => void; onDone: (batch: Batch) => void }) {
  const [form, setForm] = useState({ name: '', industry: '', city: '', email_delay_days: 10, sms_delay_days: 5, rep_name: 'Eric' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Batch name required'); return }
    setSaving(true)
    const res = await fetch('/api/marketing/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ...form, sequence_type: 'standard' }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone(data.batch)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#1a2744]">New Batch</h3>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Batch Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Windsor Realtors – Batch 1" required
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Industry</label>
              <input value={form.industry} onChange={e => set('industry', e.target.value)} placeholder="Realtors"
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">City</label>
              <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Windsor"
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Email delay (days after mail)</label>
              <input type="number" min={1} max={30} value={form.email_delay_days} onChange={e => set('email_delay_days', Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">SMS delay (days after email)</label>
              <input type="number" min={1} max={30} value={form.sms_delay_days} onChange={e => set('sms_delay_days', Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Rep Name</label>
            <input value={form.rep_name} onChange={e => set('rep_name', e.target.value)} placeholder="Eric"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create Batch'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mark Mailed Modal ────────────────────────────────────────────────────────

function MarkMailedModal({ batch, onClose, onDone }: {
  batch: Batch
  onClose: () => void
  onDone: () => void
}) {
  const [mailDate, setMailDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailDate = addDays(mailDate, batch.email_delay_days ?? 10)
  const smsDate = addDays(emailDate, batch.sms_delay_days ?? 5)

  async function submit() {
    setSaving(true)
    const res = await fetch(`/api/marketing/batches/${batch.id}/mark-mailed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ mail_date: mailDate }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#1a2744]">Mark as Mailed</h3>
            <p className="mt-0.5 text-sm text-slate-500">{batch.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Date Mail Was Sent</label>
            <input type="date" value={mailDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setMailDate(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="rounded-[18px] bg-slate-50 border border-slate-200 p-4 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Auto-sequence fires:</div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">✉️ Email follow-up</span>
              <span className="font-semibold text-[#1a2744]">{fmtDate(emailDate)} <span className="font-normal text-slate-400">({batch.email_delay_days ?? 10}d after mail)</span></span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">💬 SMS nudge</span>
              <span className="font-semibold text-[#1a2744]">{fmtDate(smsDate)} <span className="font-normal text-slate-400">({(batch.sms_delay_days ?? 5)}d after email)</span></span>
            </div>
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#f5a623] py-2.5 text-sm font-semibold text-[#1a2744] disabled:opacity-50">{saving ? 'Logging…' : '✓ Confirm Mailed'}</button>
          </div>
        </div>
      </div>
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
      if (parsed.length === 0) { setError('Could not parse CSV.'); return }
      const cols = Object.keys(parsed[0])
      setHeaders(cols); setRows(parsed); setError(null)
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
    setImporting(true); setError(null)
    const contacts = rows.map(row => {
      const c: Record<string, string> = {}
      for (const [field, col] of Object.entries(mapping)) { if (col) c[field] = row[col] ?? '' }
      return c
    })
    const res = await fetch('/api/marketing/contacts/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ batch_id: batch.id, contacts }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) { setError(data.error ?? 'Import failed'); setImporting(false); return }
    onDone(data.inserted)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#1a2744]">Import Contacts</h3>
            <p className="mt-0.5 text-sm text-slate-500">{batch.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        {rows.length === 0 ? (
          <div className="mt-6">
            <div onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-[18px] border-2 border-dashed border-slate-300 p-10 text-center hover:border-[#1a2744]">
              <div className="text-2xl">📄</div>
              <div className="mt-2 text-sm font-medium text-slate-600">Click to upload CSV</div>
              <div className="mt-1 text-xs text-slate-400">Headers: Name, Email, Phone, Company, City…</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
              {rows.length} rows · Map columns below
            </div>
            <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
              {FIELDS.map(field => (
                <div key={field}>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{field}</label>
                  <select value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                    className="mt-0.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-[#1a2744] outline-none">
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={doImport} disabled={importing} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{importing ? 'Importing…' : `Import ${rows.length} contacts`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab 1: Overview ─────────────────────────────────────────────────────────

function OverviewTab({ batches, contacts, loading, onRefresh, onTabChange }: {
  batches: Batch[]
  contacts: Contact[]
  loading: boolean
  onRefresh: () => void
  onTabChange: (tab: Tab) => void
}) {
  const [newBatchOpen, setNewBatchOpen] = useState(false)
  const [markMailedBatch, setMarkMailedBatch] = useState<Batch | null>(null)
  const [csvBatch, setCsvBatch] = useState<Batch | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const activeBatches = batches.filter(b => b.status === 'active')
  const totalMailed = batches.reduce((s, b) => s + (b.total_contacts || 0), 0)
  const totalResponded = batches.reduce((s, b) => s + (b.responded_count || 0), 0)
  const totalPartners = batches.reduce((s, b) => s + (b.partner_count || 0), 0)
  const needsReply = contacts.filter(c => c.sequence_paused && !c.decision)

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total Mailed', value: totalMailed, color: 'text-[#1a2744]' },
          { label: 'Responded', value: totalResponded, color: 'text-violet-700' },
          { label: 'Needs Reply', value: needsReply.length, color: needsReply.length > 0 ? 'text-amber-600' : 'text-[#1a2744]' },
          { label: 'Partners Won', value: totalPartners, color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="rounded-[20px] border border-slate-200 bg-white p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{s.label}</div>
            <div className={`mt-2 text-4xl font-bold tracking-tight ${s.color}`}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Needs reply alert */}
      {needsReply.length > 0 && (
        <button onClick={() => onTabChange('pipeline')}
          className="w-full rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-left hover:bg-amber-100 transition">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔔</span>
              <div>
                <div className="font-semibold text-amber-800">{needsReply.length} contact{needsReply.length !== 1 ? 's' : ''} responded — ready for human follow-up</div>
                <div className="mt-0.5 text-xs text-amber-600">{needsReply.slice(0, 3).map(c => c.name).join(', ')}{needsReply.length > 3 ? ` +${needsReply.length - 3} more` : ''}</div>
              </div>
            </div>
            <span className="text-sm font-semibold text-amber-700">Open Pipeline →</span>
          </div>
        </button>
      )}

      {/* Batch cards + new batch button */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#1a2744]">Batches</h2>
          <button onClick={() => setNewBatchOpen(true)}
            className="rounded-xl bg-[#f5a623] px-4 py-2 text-sm font-semibold text-[#1a2744] hover:brightness-95 transition">
            + New Batch
          </button>
        </div>

        {loading ? (
          <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : batches.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-slate-300 bg-white p-10 text-center">
            <div className="text-3xl">📬</div>
            <div className="mt-3 text-sm font-semibold text-slate-600">No batches yet</div>
            <div className="mt-1 text-xs text-slate-400">Create your first batch, upload your contact list, then mark it as mailed.</div>
            <button onClick={() => setNewBatchOpen(true)} className="mt-4 rounded-xl bg-[#1a2744] px-5 py-2 text-sm font-semibold text-white">+ New Batch</button>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map(batch => {
              const mailed = !!batch.mail_sent_date
              const emailDate = mailed ? addDays(batch.mail_sent_date!, batch.email_delay_days ?? 10) : null
              const smsDate = emailDate ? addDays(emailDate, batch.sms_delay_days ?? 5) : null
              const emailDays = emailDate ? daysUntil(emailDate) : null
              const smsDays = smsDate ? daysUntil(smsDate) : null
              const responseRate = batch.total_contacts > 0 ? Math.round((batch.responded_count / batch.total_contacts) * 100) : 0

              return (
                <div key={batch.id} className="rounded-[22px] border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#1a2744]">{batch.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${batch.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {batch.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                        {batch.industry && <span>{batch.industry}</span>}
                        {batch.city && <span>{batch.city}</span>}
                        <span>{batch.total_contacts} contacts</span>
                        {batch.responded_count > 0 && <span className="text-violet-600">{batch.responded_count} responded ({responseRate}%)</span>}
                        {batch.partner_count > 0 && <span className="text-emerald-600">{batch.partner_count} partners won</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 items-end">
                      {!mailed && batch.total_contacts > 0 && (
                        <button onClick={() => setMarkMailedBatch(batch)}
                          className="rounded-xl bg-[#f5a623] px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:brightness-95">
                          Mark as Mailed
                        </button>
                      )}
                      <button onClick={() => setCsvBatch(batch)}
                        className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        + Import
                      </button>
                    </div>
                  </div>

                  {mailed && (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="rounded-[14px] bg-slate-50 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mailed</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{fmtDate(batch.mail_sent_date)}</div>
                      </div>
                      <div className={`rounded-[14px] p-3 ${emailDays !== null && emailDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">✉️ Email</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">
                          {emailDays !== null && emailDays <= 0 ? '✅ Sent' : emailDate ? fmtDate(emailDate) : '—'}
                        </div>
                        {emailDays !== null && emailDays > 0 && (
                          <div className="text-[10px] text-amber-600 font-semibold">in {emailDays}d</div>
                        )}
                      </div>
                      <div className={`rounded-[14px] p-3 ${smsDays !== null && smsDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">💬 SMS</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">
                          {smsDays !== null && smsDays <= 0 ? '✅ Sent' : smsDate ? fmtDate(smsDate) : '—'}
                        </div>
                        {smsDays !== null && smsDays > 0 && (
                          <div className="text-[10px] text-amber-600 font-semibold">in {smsDays}d</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {newBatchOpen && (
        <NewBatchModal onClose={() => setNewBatchOpen(false)} onDone={b => { setNewBatchOpen(false); onRefresh(); showToast(`Batch "${b.name}" created`) }} />
      )}
      {markMailedBatch && (
        <MarkMailedModal batch={markMailedBatch} onClose={() => setMarkMailedBatch(null)} onDone={() => { setMarkMailedBatch(null); onRefresh(); showToast('Batch marked as mailed — sequence timer started') }} />
      )}
      {csvBatch && (
        <CsvImportModal batch={csvBatch} onClose={() => setCsvBatch(null)} onDone={n => { setCsvBatch(null); onRefresh(); showToast(`${n} contacts imported`) }} />
      )}
    </div>
  )
}

// ─── Tab 2: Pipeline ──────────────────────────────────────────────────────────

const PIPELINE_COLS = [
  { key: 'connected',          label: '💬 Engaged',          color: 'bg-violet-50 border-violet-200' },
  { key: 'qualified',          label: '🗣 Spoke / Qualified', color: 'bg-orange-50 border-orange-200' },
  { key: 'partnership_active', label: '✅ Active Partner',    color: 'bg-emerald-50 border-emerald-200' },
  { key: 'dormant',            label: '❄️ Nurture',           color: 'bg-slate-50 border-slate-200' },
]

function PipelineTab({
  contacts,
  onSelect,
  onStageChange,
}: {
  contacts: Contact[]
  onSelect: (c: Contact) => void
  onStageChange: (contactId: string, stage: string) => Promise<void>
}) {
  const responded = contacts.filter(c => c.sequence_paused)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  if (responded.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white p-16 text-center">
        <div className="text-4xl">📭</div>
        <div className="mt-4 text-base font-semibold text-[#1a2744]">No responses yet</div>
        <div className="mt-2 text-sm text-slate-500">People who reply to your outreach show up here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1a2744]">Relationship Pipeline</h2>
          <p className="text-sm text-slate-500">{responded.length} contact{responded.length !== 1 ? 's' : ''} in play</p>
        </div>
        <div className="text-xs font-medium text-slate-400">Drag a contact into the next column to update the relationship stage.</div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_COLS.map(col => {
          const col_contacts = responded.filter(c => c.normalized_stage === col.key)
          return (
            <div
              key={col.key}
              onDragOver={event => {
                event.preventDefault()
                if (draggingId) setDropTarget(col.key)
              }}
              onDragLeave={event => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                setDropTarget(current => current === col.key ? null : current)
              }}
              onDrop={event => {
                event.preventDefault()
                const contactId = event.dataTransfer.getData('text/plain') || draggingId
                if (!contactId) return
                const current = responded.find(item => item.id === contactId)
                setDropTarget(null)
                setDraggingId(null)
                if (!current || current.normalized_stage === col.key) return
                setMovingId(contactId)
                void onStageChange(contactId, col.key).finally(() => setMovingId(currentId => currentId === contactId ? null : currentId))
              }}
              className={`rounded-[22px] border p-4 transition ${col.color} ${dropTarget === col.key ? 'ring-2 ring-[#1a2744] ring-offset-2 ring-offset-white' : ''}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">{col.label}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{col_contacts.length}</span>
              </div>
              <div className="space-y-2">
                {col_contacts.length === 0 ? (
                  <div className={`rounded-[14px] border border-dashed border-slate-200 bg-white/50 p-4 text-center text-xs text-slate-400 transition ${dropTarget === col.key ? 'border-[#1a2744] bg-white text-[#1a2744]' : ''}`}>Drop here</div>
                ) : col_contacts.map(c => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => onSelect(c)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(c)
                      }
                    }}
                    onDragStart={event => {
                      event.dataTransfer.setData('text/plain', c.id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggingId(c.id)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setDropTarget(null)
                    }}
                    className={`w-full rounded-[16px] border border-white bg-white p-3 text-left shadow-sm transition hover:shadow-md ${draggingId === c.id ? 'cursor-grabbing opacity-50' : 'cursor-grab'} ${movingId === c.id ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    <div className="text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{c.city ?? ''}</span>
                      {movingId === c.id ? <span>Saving…</span> : c.last_touch_at && <span>{timeAgo(c.last_touch_at)}</span>}
                    </div>
                    {c.decision && (
                      <div className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.decision === 'agreed' ? 'bg-emerald-100 text-emerald-700' : c.decision === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.decision}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Tab 3: Phone ─────────────────────────────────────────────────────────────

const PARTNERSHIP_FROM_NUMBER = '+12267746581'
const PARTNERSHIP_FROM_EMAIL = 'eric@starmovers.ca'

function PhoneTab({ contacts }: { contacts: Contact[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [touches, setTouches] = useState<Touch[]>([])
  const [touchLoading, setTouchLoading] = useState(false)
  const [composeChannel, setComposeChannel] = useState<'sms' | 'email'>('sms')
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showDecision, setShowDecision] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const sorted = [...contacts]
    .sort((a, b) => (b.last_touch_at ?? '').localeCompare(a.last_touch_at ?? ''))
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase()))

  const selected = contacts.find(c => c.id === selectedId) ?? null
  const selectedPreview = selected ? getContactPreview(selected) : null
  const selectedFromQuery = searchParams.get('contact')
  const firstSortedId = sorted[0]?.id ?? null

  useEffect(() => {
    if (selectedFromQuery && contacts.some(contact => contact.id === selectedFromQuery)) {
      setSelectedId(current => current === selectedFromQuery ? current : selectedFromQuery)
      return
    }
    if (!selectedId && firstSortedId) {
      setSelectedId(firstSortedId)
    }
  }, [contacts, firstSortedId, selectedFromQuery, selectedId])

  useEffect(() => {
    if (!selectedId) return
    setTouches([]); setTouchLoading(true)
    fetch(`/api/marketing/touches?contact_id=${selectedId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setTouches(Array.isArray(data) ? data : []))
      .finally(() => setTouchLoading(false))
  }, [selectedId])

  useEffect(() => {
    if (selected) {
      const firstName = selected.name.split(' ')[0] || 'there'
      setSmsBody(`Hi ${firstName}, Eric from Saturn Star Movers here. Following up on the letter we sent to ${selected.company || 'you'} — open to a quick 5-min call?`)
      setEmailSubject(`Partnership Opportunity — Saturn Star Moving`)
      setEmailBody(`Hi ${firstName},\n\nI wanted to follow up on the letter we sent to ${selected.company || 'your team'} about a partnership with Saturn Star Moving.\n\nWe help people move, and we think there's a real opportunity for us to refer clients to each other. Would you be open to a quick 10-minute call?\n\nEric\nHead of Partnerships | Saturn Star Movers\n+1 (226) 774-6581 | eric@starmovers.ca`)
    }
  }, [selected?.id])

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [touches])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleSelectContact(contactId: string) {
    setSelectedId(contactId)
    router.replace(`/marketing/partners?tab=phone&contact=${contactId}`, { scroll: false })
  }

  async function handleSend() {
    if (!selected) return
    if (composeChannel === 'sms' && (!selected.phone || !smsBody.trim())) return
    if (composeChannel === 'email' && (!selected.email || !emailBody.trim())) return
    setSending(true)
    try {
      await sendSalesMessage(
        composeChannel === 'sms'
          ? { channel: 'sms', to: selected.phone!, body: smsBody, fromNumber: PARTNERSHIP_FROM_NUMBER }
          : { channel: 'email', to: selected.email!, subject: emailSubject, body: emailBody }
      )
      await fetch('/api/marketing/touches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          contact_id: selected.id, channel: composeChannel, direction: 'outbound',
          notes: composeChannel === 'sms' ? smsBody : `Subject: ${emailSubject}\n\n${emailBody}`,
          schedule_follow_up_days: 3,
        }),
      })
      showToast(composeChannel === 'sms' ? '💬 SMS sent' : '✉️ Email sent')
      // Refresh touches
      fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(data => setTouches(Array.isArray(data) ? data : []))
    } catch { showToast('Send failed') }
    setSending(false)
  }

  async function logCall() {
    if (!selected) return
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: selected.id, channel: 'call', direction: 'outbound', notes: 'Called from partnership phone', schedule_follow_up_days: 2 }),
    })
    showToast('📞 Call logged')
    fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setTouches(Array.isArray(data) ? data : []))
  }

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[520px] rounded-[24px] border border-slate-200 bg-white overflow-hidden">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">
          {toast}
        </div>
      )}

      {/* Left — contact list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200">
        <div className="p-3 border-b border-slate-100">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {sorted.map(c => {
            const unread = c.needs_follow_up || (c.sequence_paused && !c.decision)
            const preview = getContactPreview(c)
            return (
              <button key={c.id} onClick={() => handleSelectContact(c.id)}
                className={`w-full px-4 py-3 text-left border-b border-slate-100 transition hover:bg-slate-50 ${selectedId === c.id ? 'bg-[#1a2744]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-semibold text-sm truncate ${selectedId === c.id ? 'text-white' : 'text-[#1a2744]'}`}>{c.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {unread && selectedId !== c.id && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                    <span className={`text-[10px] ${selectedId === c.id ? 'text-white/60' : 'text-slate-400'}`}>{timeAgo(c.last_touch_at)}</span>
                  </div>
                </div>
                <div className={`mt-0.5 text-xs truncate ${selectedId === c.id ? 'text-white/70' : 'text-slate-400'}`}>
                  {c.company ?? c.industry ?? c.city ?? '—'}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <StageBadge stage={c.normalized_stage} />
                  {preview && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${selectedId === c.id ? 'bg-white/15 text-white/90' : preview.automated ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {preview.label}
                    </span>
                  )}
                </div>
                {preview?.body && (
                  <div className={`mt-2 text-[11px] leading-4 ${selectedId === c.id ? 'text-white/75' : 'text-slate-500'}`}>
                    {truncateText(preview.body, 96)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right — contact detail + compose */}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <div className="text-center">
            <div className="text-4xl">📱</div>
            <div className="mt-3 text-sm font-medium">Select a contact</div>
            <div className="mt-1 text-xs">View their history and send a message</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col min-w-0">
          {/* Contact header */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white">
                {selected.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#1a2744]">{selected.name}</span>
                  <StageBadge stage={selected.normalized_stage} />
                  {selected.sequence_paused && !selected.decision && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Responded ↗</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  {selected.company && <span>{selected.company}</span>}
                  {selected.city && <span>{selected.city}</span>}
                  {selected.phone && <span>{selected.phone}</span>}
                  {selected.email && <span>{selected.email}</span>}
                </div>
                {selectedPreview && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${selectedPreview.automated ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {selectedPreview.label}
                    </span>
                    {selectedPreview.body && <span className="text-xs text-slate-500">{truncateText(selectedPreview.body, 140)}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selected.phone && (
                <a href={`tel:${selected.phone}`} onClick={logCall}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition">
                  📞 Call
                </a>
              )}
              {selected.sequence_paused && !selected.decision && (
                <button onClick={() => setShowDecision(true)}
                  className="rounded-xl bg-[#1a2744] px-3 py-2 text-sm font-semibold text-white hover:bg-[#243560]">
                  Log Decision
                </button>
              )}
            </div>
          </div>

          {/* Touch timeline */}
          <div ref={threadRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
            {touchLoading && <div className="text-center text-xs text-slate-400 py-8">Loading history…</div>}
            {!touchLoading && touches.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-8">No touch history yet. Send the first message below.</div>
            )}
            {[...touches].reverse().map(touch => {
              const summary = summarizeTouch(touch.channel, touch.direction, touch.notes)
              return (
              <div key={touch.id} className={`flex gap-3 ${touch.direction === 'outbound' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${touch.direction === 'outbound' ? 'bg-[#1a2744]' : 'bg-white border border-slate-200'}`}>
                  <ChannelIcon channel={touch.channel} direction={touch.direction} />
                </div>
                <div className={`max-w-[70%] rounded-[16px] px-4 py-2.5 text-sm ${touch.direction === 'outbound' ? 'bg-[#1a2744] text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-[#1a2744] rounded-tl-sm'}`}>
                  <div className={`mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${touch.direction === 'outbound' ? 'text-white/70' : 'text-slate-400'}`}>
                    <span>{summary.label}</span>
                    {summary.automated && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${touch.direction === 'outbound' ? 'bg-white/15 text-white/90' : 'bg-slate-100 text-slate-500'}`}>
                        Auto
                      </span>
                    )}
                  </div>
                  {summary.body && <div className="whitespace-pre-wrap leading-relaxed">{summary.body}</div>}
                  {touch.outcome_code && <div className={`mt-1 text-[10px] font-semibold uppercase ${touch.direction === 'outbound' ? 'text-white/60' : 'text-slate-400'}`}>{touch.outcome_code}</div>}
                  <div className={`mt-1 text-[10px] ${touch.direction === 'outbound' ? 'text-white/50' : 'text-slate-400'}`}>
                    {touch.channel} · {fmtDate(touch.created_at)} {fmtTime(touch.created_at)}
                  </div>
                </div>
              </div>
            )})}
          </div>

          {/* Compose */}
          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="mb-3 flex gap-2">
              <button onClick={() => setComposeChannel('sms')}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${composeChannel === 'sms' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                💬 SMS {!selected.phone && <span className="ml-1 text-red-400">no #</span>}
              </button>
              <button onClick={() => setComposeChannel('email')}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${composeChannel === 'email' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                ✉️ Email {!selected.email && <span className="ml-1 text-red-400">no email</span>}
              </button>
            </div>

            {composeChannel === 'sms' ? (
              <div className="flex gap-2">
                <textarea value={smsBody} onChange={e => setSmsBody(e.target.value)} rows={2}
                  placeholder={selected.phone ? 'Type SMS…' : 'No phone number on file'}
                  disabled={!selected.phone}
                  className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40" />
                <button onClick={handleSend} disabled={sending || !selected.phone || !smsBody.trim()}
                  className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                  className="h-9 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
                <div className="flex gap-2">
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3}
                    placeholder={selected.email ? 'Type email…' : 'No email on file'}
                    disabled={!selected.email}
                    className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40" />
                  <button onClick={handleSend} disabled={sending || !selected.email || !emailBody.trim()}
                    className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showDecision && selected && (
        <DecisionModal contact={selected} onClose={() => setShowDecision(false)}
          onDone={() => { setShowDecision(false); fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(data => setTouches(Array.isArray(data) ? data : [])) }} />
      )}
    </div>
  )
}

// ─── Tab 4: Partners ──────────────────────────────────────────────────────────

function PartnersTab({ contacts, onSelect }: { contacts: Contact[]; onSelect: (c: Contact) => void }) {
  const partners = contacts.filter(c => c.decision === 'agreed' || c.normalized_stage === 'partnership_active')

  if (partners.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white p-16 text-center">
        <div className="text-4xl">🤝</div>
        <div className="mt-4 text-base font-semibold text-[#1a2744]">No active partners yet</div>
        <div className="mt-2 text-sm text-slate-500">Once you log a decision of "Agreed", they appear here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[#1a2744]">Active Partners</h2>
        <p className="text-sm text-slate-500">{partners.length} partnership{partners.length !== 1 ? 's' : ''} active — keep the relationship warm</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {partners.map(c => {
          const daysSince = c.last_touch_at ? Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) : null
          const needsTouch = daysSince !== null && daysSince > 30
          return (
            <button key={c.id} onClick={() => onSelect(c)}
              className={`rounded-[22px] border bg-white p-5 text-left hover:shadow-md transition ${needsTouch ? 'border-amber-300' : 'border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                  {c.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[#1a2744] truncate">{c.name}</div>
                  <div className="text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {c.phone && <div className="rounded-[10px] bg-slate-50 p-2"><div className="text-[9px] font-semibold uppercase text-slate-400">Phone</div><div className="mt-0.5 font-medium text-[#1a2744]">{c.phone}</div></div>}
                {c.email && <div className="rounded-[10px] bg-slate-50 p-2 col-span-2 truncate"><div className="text-[9px] font-semibold uppercase text-slate-400">Email</div><div className="mt-0.5 font-medium text-[#1a2744] truncate">{c.email}</div></div>}
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Last Touch</div>
                  <div className={`mt-0.5 font-medium ${needsTouch ? 'text-amber-600' : 'text-[#1a2744]'}`}>
                    {daysSince !== null ? `${daysSince}d ago` : '—'}
                    {needsTouch && ' ⚠️'}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Contact Drawer ───────────────────────────────────────────────────────────

function ContactDrawer({ contact, onClose, onRefresh }: {
  contact: Contact
  onClose: () => void
  onRefresh: () => void
}) {
  const [touches, setTouches] = useState<Touch[]>([])
  const [loading, setLoading] = useState(true)
  const [showDecision, setShowDecision] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setTouches(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
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
          <div className="mt-2 flex flex-wrap gap-2">
            <StageBadge stage={contact.normalized_stage} />
            {contact.sequence_paused && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-semibold text-violet-700">Responded</span>}
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="rounded-[18px] border border-slate-100 bg-slate-50 p-4 space-y-2">
            {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-slate-700 hover:text-[#1a2744]">📞 {contact.phone}</a>}
            {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-slate-700 hover:text-[#1a2744]">✉️ {contact.email}</a>}
            {contact.city && <div className="text-sm text-slate-500">📍 {contact.city}</div>}
          </div>
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
          {contact.sequence_paused && !contact.decision && (
            <button onClick={() => setShowDecision(true)}
              className="w-full rounded-[18px] border-2 border-[#1a2744] bg-[#1a2744] py-3 text-sm font-semibold text-white hover:bg-[#243560]">
              Log Decision
            </button>
          )}
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Touch History</div>
            {loading ? <div className="text-xs text-slate-400">Loading…</div> : touches.length === 0 ? (
              <div className="text-xs text-slate-400">No touches logged yet.</div>
            ) : (
              <div className="space-y-2">
                {touches.map(t => (
                  <div key={t.id} className="flex gap-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                    <div className="mt-0.5 text-base"><ChannelIcon channel={t.channel} direction={t.direction} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#1a2744] capitalize">{t.channel} {t.direction === 'inbound' ? '← In' : '→ Out'}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{fmtDate(t.created_at)}</span>
                      </div>
                      {t.notes && <div className="mt-0.5 text-xs text-slate-600 line-clamp-2">{t.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {showDecision && (
        <DecisionModal contact={contact} onClose={() => setShowDecision(false)} onDone={() => { setShowDecision(false); onRefresh(); onClose() }} />
      )}
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'pipeline' | 'phone' | 'partners'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview',  label: 'Overview',  icon: '📊' },
  { key: 'pipeline',  label: 'Pipeline',  icon: '🎯' },
  { key: 'phone',     label: 'Phone',     icon: '📱' },
  { key: 'partners',  label: 'Partners',  icon: '🤝' },
]

function PartnershipEngineInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'overview')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const r = await fetch('/api/marketing/contacts?limit=500&offset=0', { credentials: 'include' })
    if (r.ok) { const d = await r.json(); setContacts(d.contacts ?? []) }
    setContactsLoading(false)
  }, [])

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true)
    const r = await fetch('/api/marketing/batches', { credentials: 'include' })
    if (r.ok) setBatches(await r.json())
    setBatchesLoading(false)
  }, [])

  useEffect(() => { void loadContacts() }, [loadContacts])
  useEffect(() => { void loadBatches() }, [loadBatches])

  function handleTabChange(t: Tab) {
    setTab(t)
    router.replace(`/marketing/partners?tab=${t}`, { scroll: false })
  }

  const needsReplyCount = contacts.filter(c => c.sequence_paused && !c.decision).length

  async function handlePipelineStageChange(contactId: string, stage: string) {
    const previous = contacts
    setContacts(current => current.map(contact => (
      contact.id === contactId
        ? {
            ...contact,
            stage,
            normalized_stage: stage,
            last_touch_at: new Date().toISOString(),
          }
        : contact
    )))

    const response = await fetch('/api/marketing/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: contactId, stage }),
    })

    if (!response.ok) {
      setContacts(previous)
      return
    }

    const data = await response.json().catch(() => null) as { contact?: Partial<Contact> } | null
    const updated = data?.contact
    if (!updated) return

    setContacts(current => current.map(contact => (
      contact.id === contactId
        ? {
            ...contact,
            ...updated,
            normalized_stage: String(updated.stage || stage),
          }
        : contact
    )))
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1a2744]">Partnership Engine</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {batchesLoading ? '—' : batches.length} batch{batches.length !== 1 ? 'es' : ''} · {contactsLoading ? '—' : contacts.length} contacts
              {needsReplyCount > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{needsReplyCount} need reply</span>}
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex gap-1 rounded-[16px] border border-slate-200 bg-white p-1.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-semibold transition ${tab === t.key ? 'bg-[#1a2744] text-white shadow-sm' : 'text-slate-500 hover:text-[#1a2744]'}`}>
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {t.key === 'pipeline' && needsReplyCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>{needsReplyCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <OverviewTab batches={batches} contacts={contacts} loading={batchesLoading || contactsLoading} onRefresh={() => { void loadBatches(); void loadContacts() }} onTabChange={handleTabChange} />
        )}
        {tab === 'pipeline' && (
          <PipelineTab contacts={contacts} onSelect={setSelectedContact} onStageChange={handlePipelineStageChange} />
        )}
        {tab === 'phone' && (
          <PhoneTab contacts={contacts} />
        )}
        {tab === 'partners' && (
          <PartnersTab contacts={contacts} onSelect={setSelectedContact} />
        )}

        {selectedContact && (
          <ContactDrawer contact={selectedContact} onClose={() => setSelectedContact(null)}
            onRefresh={() => { void loadContacts(); void loadBatches() }} />
        )}
      </div>
    </div>
  )
}

export default function PartnershipEngine() {
  return (
    <Suspense>
      <PartnershipEngineInner />
    </Suspense>
  )
}
