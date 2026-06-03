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
  outreach_tier?: number | null
  instantly_status?: string | null
  instantly_campaign_id?: string | null
}

interface Touch {
  id: string
  channel: string
  direction: string
  notes: string | null
  created_at: string
  outcome_code: string | null
  next_step: string | null
  metadata: Record<string, unknown> | null
}

interface List {
  id: string
  name: string
  description: string | null
  tier: number | null
  color: string
  contact_count: number
  created_at: string
}

interface Appointment {
  id: string
  contact_id: string
  title: string
  scheduled_at: string
  duration_minutes: number
  channel: string
  notes: string | null
  status: string
}

interface InstantlyCampaign {
  id: string
  name: string
  status: number
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTime(d?: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(d?: string | null) {
  if (!d) return '—'
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

function daysUntil(d?: string | null) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
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

function truncateText(value: string, max = 120) {
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}

function unwrapAutoTouch(value: string, prefix: string) {
  return value.replace(prefix, '').trim().replace(/^"/, '').replace(/"$/, '')
}

function summarizeTouch(channel: string, direction?: string | null, notes?: string | null) {
  const text = (notes || '').trim()
  if (text.startsWith('Auto-SMS sent:')) return { label: 'Auto SMS', body: unwrapAutoTouch(text, 'Auto-SMS sent:'), auto: true }
  if (text.startsWith('Auto-email sent:')) return { label: 'Auto Email', body: unwrapAutoTouch(text, 'Auto-email sent:'), auto: true }
  if (text.startsWith('Added to Instantly')) return { label: 'Added to Instantly', body: text, auto: true }
  const src = (text.match(/source["\s:]+instantly/i) || (notes && JSON.stringify(notes).includes('instantly')))
  if (channel === 'email' && direction === 'inbound' && text.includes('Instantly')) return { label: 'Instantly Reply', body: text }
  if (channel === 'email' && text.includes('opened')) return { label: 'Email Opened', body: text, auto: true }
  if (channel === 'email' && text.includes('clicked')) return { label: 'Link Clicked', body: text, auto: true }
  if (channel === 'direct_mail') return { label: 'Direct Mail', body: text || 'Direct mail sent' }
  if (channel === 'phone' || channel === 'call') return { label: direction === 'inbound' ? 'Inbound Call' : 'Call', body: text || 'Call logged' }
  if (channel === 'email') return { label: direction === 'inbound' ? 'Email Reply' : 'Email Sent', body: text || 'Email' }
  if (channel === 'sms') return { label: direction === 'inbound' ? 'Inbound SMS' : 'SMS Sent', body: text || 'SMS' }
  if (channel === 'note') return { label: 'Note', body: text || 'Note saved' }
  if (channel === 'appointment' || text.includes('Appointment')) return { label: 'Appointment', body: text }
  return { label: channel.replace(/_/g, ' '), body: text }
}

function getContactPreview(contact: Contact) {
  if (contact.latest_inbound_note) return summarizeTouch(contact.latest_touch_channel || 'sms', 'inbound', contact.latest_inbound_note)
  if (contact.latest_touch_note) return summarizeTouch(contact.latest_touch_channel || 'note', contact.latest_touch_direction, contact.latest_touch_note)
  return null
}

// ─── Small components ─────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const meta = PARTNERSHIP_STAGE_META[stage as keyof typeof PARTNERSHIP_STAGE_META]
  if (!meta) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">{stage}</span>
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
}

function TierBadge({ tier }: { tier?: number | null }) {
  if (!tier) return null
  const styles: Record<number, string> = {
    1: 'bg-amber-100 text-amber-800',
    2: 'bg-sky-100 text-sky-700',
    3: 'bg-slate-100 text-slate-600',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[tier] ?? 'bg-slate-100 text-slate-500'}`}>T{tier}</span>
}

function InstantlyBadge({ status }: { status?: string | null }) {
  if (!status) return null
  const styles: Record<string, string> = {
    active: 'bg-violet-100 text-violet-700',
    sent: 'bg-violet-100 text-violet-700',
    opened: 'bg-blue-100 text-blue-700',
    clicked: 'bg-cyan-100 text-cyan-700',
    replied: 'bg-emerald-100 text-emerald-700',
    bounced: 'bg-rose-100 text-rose-700',
    removed: 'bg-slate-100 text-slate-400',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${styles[status] ?? 'bg-slate-100 text-slate-500'}`}>✉ {status}</span>
}

function ChannelIcon({ channel, direction }: { channel: string; direction?: string }) {
  if (channel === 'call' || channel === 'phone') return <span>{direction === 'inbound' ? '📲' : '📞'}</span>
  if (channel === 'sms') return <span>💬</span>
  if (channel === 'email') return <span>✉️</span>
  if (channel === 'direct_mail') return <span>📬</span>
  if (channel === 'linkedin') return <span>🔗</span>
  if (channel === 'note') return <span>📝</span>
  if (channel === 'appointment') return <span>📅</span>
  return <span>📌</span>
}

// ─── Dialer hook ──────────────────────────────────────────────────────────────

type DialStatus = 'idle' | 'loading' | 'ready' | 'connecting' | 'connected'

function useDialer() {
  const [status, setStatus] = useState<DialStatus>('idle')
  const deviceRef = useRef<unknown>(null)
  const callRef = useRef<unknown>(null)

  async function ensureReady() {
    if (deviceRef.current) return true
    setStatus('loading')
    await new Promise<void>(resolve => {
      if ((window as unknown as Record<string, unknown>).Twilio) { resolve(); return }
      const s = document.createElement('script')
      s.src = 'https://media.twiliocdn.com/sdk/js/voice/v2.0/twilio.min.js'
      s.onload = () => resolve()
      document.head.appendChild(s)
    })
    const res = await fetch('/api/marketing/dialer/token', { credentials: 'include' })
    if (!res.ok) { setStatus('idle'); return false }
    const { token } = await res.json() as { token: string }
    const TwilioSDK = (window as unknown as Record<string, unknown>).Twilio as { Device: new (token: string) => unknown }
    deviceRef.current = new TwilioSDK.Device(token)
    setStatus('ready')
    return true
  }

  async function call(phoneNumber: string) {
    const ready = await ensureReady()
    if (!ready || !deviceRef.current) return
    setStatus('connecting')
    const device = deviceRef.current as { connect: (opts?: unknown) => Promise<unknown> }
    const conn = await device.connect({ params: { To: phoneNumber } } as unknown) as { on: (event: string, cb: () => void) => void; disconnect?: () => void }
    callRef.current = conn
    conn.on('accept', () => setStatus('connected'))
    conn.on('disconnect', () => { setStatus('ready'); callRef.current = null })
    conn.on('error', () => { setStatus('ready'); callRef.current = null })
  }

  function hangup() {
    const conn = callRef.current as { disconnect?: () => void } | null
    conn?.disconnect?.()
  }

  return { status, call, hangup }
}

// ─── Appointment Modal ────────────────────────────────────────────────────────

function AppointmentModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const [form, setForm] = useState({ title: 'Follow-up call', scheduled_at: now.toISOString().slice(0, 16), duration_minutes: 30, channel: 'phone', notes: '' })
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/marketing/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contact.id, ...form, scheduled_at: new Date(form.scheduled_at).toISOString() }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Book Appointment</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500">Date & Time</label>
              <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} required
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Channel</label>
              <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                <option value="phone">📞 Phone</option>
                <option value="in_person">🤝 In person</option>
                <option value="email">✉️ Email</option>
                <option value="video">📹 Video</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Book'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add to Instantly Modal ───────────────────────────────────────────────────

function AddToInstantlyModal({ contact, onClose, onDone }: {
  contact: Contact
  onClose: () => void
  onDone: () => void
}) {
  const [campaigns, setCampaigns] = useState<InstantlyCampaign[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/marketing/instantly/campaigns', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.campaigns) setCampaigns(d.campaigns) })
  }, [])

  async function submit() {
    if (!selectedId || !contact.email) return
    setSaving(true)
    const nameParts = contact.name.trim().split(' ')
    const res = await fetch('/api/marketing/instantly/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        contact_id: contact.id,
        campaign_id: selectedId,
        email: contact.email,
        first_name: nameParts[0] ?? '',
        last_name: nameParts.slice(1).join(' ') ?? '',
        company_name: contact.company ?? '',
        phone: contact.phone ?? '',
      }),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Add to Instantly</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name} · {contact.email ?? 'no email'}</p>
        {!contact.email && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">This contact has no email address.</div>}
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500">Campaign</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
              <option value="">— select campaign —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {error && <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving || !selectedId || !contact.email}
              className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Adding…' : 'Add to Campaign'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add to List Modal ────────────────────────────────────────────────────────

function AddToListModal({ contact, lists, onClose, onDone }: {
  contact: Contact
  lists: List[]
  onClose: () => void
  onDone: () => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!selectedId) return
    setSaving(true)
    await fetch(`/api/marketing/lists/${selectedId}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: [contact.id] }),
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[24px] border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#1a2744]">Add to List</h3>
        <p className="mt-0.5 text-sm text-slate-500">{contact.name}</p>
        <div className="mt-4 space-y-3">
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
            <option value="">— select list —</option>
            {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving || !selectedId}
              className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Adding…' : 'Add'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Decision Modal ───────────────────────────────────────────────────────────

function DecisionModal({ contact, onClose, onDone }: { contact: Contact; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'agreed' | 'rejected' | 'thinking'>('agreed')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    setSaving(true)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        contact_id: contact.id, channel: 'note', direction: 'internal',
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
              {d === 'agreed' ? '✅ Won' : d === 'thinking' ? '🤔 Maybe' : '❌ Pass'}
            </button>
          ))}
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes…"
          className="mt-4 h-20 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 p-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Log'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Contact Drawer ───────────────────────────────────────────────────────────

function ContactDrawer({ contact, lists, onClose, onRefresh }: {
  contact: Contact
  lists: List[]
  onClose: () => void
  onRefresh: () => void
}) {
  const [touches, setTouches] = useState<Touch[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showDecision, setShowDecision] = useState(false)
  const [showAppointment, setShowAppointment] = useState(false)
  const [showInstantly, setShowInstantly] = useState(false)
  const [showAddToList, setShowAddToList] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`/api/marketing/appointments?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([t, a]) => {
      setTouches(Array.isArray(t) ? t : [])
      setAppointments(Array.isArray(a) ? a : [])
    }).finally(() => setLoading(false))
  }, [contact.id])

  async function saveNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contact.id, channel: 'note', direction: 'internal', notes: noteText.trim() }),
    })
    setNoteText('')
    const t = await fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.json())
    setTouches(Array.isArray(t) ? t : [])
    setSavingNote(false)
  }

  async function updateApptStatus(id: string, status: string) {
    await fetch('/api/marketing/appointments', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ id, status }),
    })
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  const upcoming = appointments.filter(a => a.status === 'scheduled' && new Date(a.scheduled_at) > new Date())
  const past = appointments.filter(a => a.status !== 'scheduled' || new Date(a.scheduled_at) <= new Date())

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-semibold text-[#1a2744]">{contact.name}</span>
                <TierBadge tier={contact.outreach_tier} />
                <StageBadge stage={contact.normalized_stage} />
                {contact.instantly_status && <InstantlyBadge status={contact.instantly_status} />}
              </div>
              <div className="mt-0.5 text-sm text-slate-500">{contact.company ?? contact.industry ?? 'No company'}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                {contact.phone && <a href={`tel:${contact.phone}`} className="hover:text-[#1a2744]">📞 {contact.phone}</a>}
                {contact.email && <a href={`mailto:${contact.email}`} className="hover:text-[#1a2744]">✉️ {contact.email}</a>}
                {contact.city && <span>📍 {contact.city}</span>}
              </div>
            </div>
            <button onClick={onClose} className="ml-2 shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100">✕</button>
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setShowAppointment(true)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744] transition">
              📅 Book Appointment
            </button>
            {!contact.instantly_campaign_id && contact.email && (
              <button onClick={() => setShowInstantly(true)}
                className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition">
                ⚡ Add to Instantly
              </button>
            )}
            <button onClick={() => setShowAddToList(true)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1a2744] hover:text-[#1a2744] transition">
              + Add to List
            </button>
            {contact.sequence_paused && !contact.decision && (
              <button onClick={() => setShowDecision(true)}
                className="rounded-xl bg-[#1a2744] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#243560] transition">
                Log Decision
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Upcoming appointments */}
          {upcoming.length > 0 && (
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Upcoming</div>
              <div className="space-y-2">
                {upcoming.map(a => (
                  <div key={a.id} className="flex items-center justify-between rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-[#1a2744]">{a.title}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(a.scheduled_at)} · {a.duration_minutes}min · {a.channel}</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => updateApptStatus(a.id, 'completed')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100">Done</button>
                      <button onClick={() => updateApptStatus(a.id, 'cancelled')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100">Cancel</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Note input */}
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="flex gap-2">
              <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder="Add a note…"
                className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
              <button onClick={saveNote} disabled={savingNote || !noteText.trim()}
                className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {savingNote ? '…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="px-5 py-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Timeline</div>
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading…</div>
            ) : touches.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No activity yet.</div>
            ) : (
              <div className="space-y-2">
                {touches.map(t => {
                  const s = summarizeTouch(t.channel, t.direction, t.notes)
                  const isInbound = t.direction === 'inbound'
                  return (
                    <div key={t.id} className="flex gap-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                      <div className="mt-0.5 text-base shrink-0"><ChannelIcon channel={t.channel} direction={t.direction} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[#1a2744]">{s.label}</span>
                            {s.auto && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">Auto</span>}
                            {isInbound && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">Inbound</span>}
                          </div>
                          <span className="shrink-0 text-[10px] text-slate-400">{fmtDate(t.created_at)} {fmtTime(t.created_at)}</span>
                        </div>
                        {s.body && <div className="mt-0.5 text-xs text-slate-600 line-clamp-3">{s.body}</div>}
                        {t.outcome_code && <div className="mt-1 text-[10px] font-semibold uppercase text-slate-400">{t.outcome_code.replace(/_/g, ' ')}</div>}
                      </div>
                    </div>
                  )
                })}
                {past.length > 0 && (
                  <div className="pt-1">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-300">Past Appointments</div>
                    {past.map(a => (
                      <div key={a.id} className="flex items-center gap-3 rounded-[14px] border border-slate-100 bg-slate-50 p-3">
                        <span className="text-base">📅</span>
                        <div>
                          <div className="text-xs font-semibold text-slate-600">{a.title}</div>
                          <div className="text-[10px] text-slate-400">{fmtDateTime(a.scheduled_at)} · <span className={a.status === 'completed' ? 'text-emerald-600' : 'text-slate-400'}>{a.status}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showDecision && <DecisionModal contact={contact} onClose={() => setShowDecision(false)} onDone={() => { setShowDecision(false); onRefresh(); onClose() }} />}
      {showAppointment && <AppointmentModal contact={contact} onClose={() => setShowAppointment(false)} onDone={() => { setShowAppointment(false); const a = fetch(`/api/marketing/appointments?contact_id=${contact.id}`, { credentials: 'include' }).then(r => r.json()).then(d => setAppointments(Array.isArray(d) ? d : [])) }} />}
      {showInstantly && <AddToInstantlyModal contact={contact} onClose={() => setShowInstantly(false)} onDone={() => { setShowInstantly(false); onRefresh() }} />}
      {showAddToList && <AddToListModal contact={contact} lists={lists} onClose={() => setShowAddToList(false)} onDone={() => { setShowAddToList(false) }} />}
    </>
  )
}

// ─── New Batch Modal ──────────────────────────────────────────────────────────

function NewBatchModal({ onClose, onDone }: { onClose: () => void; onDone: (batch: Batch) => void }) {
  const [form, setForm] = useState({ name: '', industry: '', city: '', email_delay_days: 10, sms_delay_days: 5, rep_name: 'Eric' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Batch name required'); return }
    setSaving(true)
    const res = await fetch('/api/marketing/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ...form, sequence_type: 'standard' }),
    })
    const data = await res.json() as { ok?: boolean; batch?: Batch; error?: string }
    if (!res.ok || !data.ok) { setError(data.error ?? 'Failed'); setSaving(false); return }
    onDone(data.batch!)
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
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Windsor Realtors – Batch 1" required
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Industry</label>
              <input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="Realtors"
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">City</label>
              <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Windsor"
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Email delay (days)</label>
              <input type="number" min={1} max={30} value={form.email_delay_days} onChange={e => setForm(f => ({ ...f, email_delay_days: Number(e.target.value) }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">SMS delay (days)</label>
              <input type="number" min={1} max={30} value={form.sms_delay_days} onChange={e => setForm(f => ({ ...f, sms_delay_days: Number(e.target.value) }))}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Rep Name</label>
            <input value={form.rep_name} onChange={e => setForm(f => ({ ...f, rep_name: e.target.value }))}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mark Mailed Modal ────────────────────────────────────────────────────────

function MarkMailedModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: () => void }) {
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
    const data = await res.json() as { ok?: boolean; error?: string }
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
            <label className="text-xs font-semibold text-slate-500">Date Mailed</label>
            <input type="date" value={mailDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setMailDate(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
          </div>
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Auto-sequence fires:</div>
            <div className="flex justify-between"><span className="text-slate-600">✉️ Email</span><span className="font-semibold text-[#1a2744]">{fmtDate(emailDate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-600">💬 SMS</span><span className="font-semibold text-[#1a2744]">{fmtDate(smsDate)}</span></div>
          </div>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex-1 rounded-xl bg-[#f5a623] py-2.5 text-sm font-semibold text-[#1a2744] disabled:opacity-50">{saving ? 'Saving…' : '✓ Confirm'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── CSV Import Modal ─────────────────────────────────────────────────────────

function CsvImportModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: (n: number) => void }) {
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
      const parsed = parseCSV(ev.target?.result as string)
      if (parsed.length === 0) { setError('Could not parse CSV'); return }
      const cols = Object.keys(parsed[0])
      setHeaders(cols); setRows(parsed); setError(null)
      const auto: Record<string, string> = {}
      for (const f of FIELDS) {
        const m = cols.find(c => c.toLowerCase().includes(f) || f.includes(c.toLowerCase()))
        if (m) auto[f] = m
      }
      setMapping(auto)
    }
    reader.readAsText(file)
  }

  async function doImport() {
    if (!mapping.name) { setError('Name column required'); return }
    setImporting(true)
    const contacts = rows.map(row => {
      const c: Record<string, string> = {}
      for (const [f, col] of Object.entries(mapping)) { if (col) c[f] = row[col] ?? '' }
      return c
    })
    const res = await fetch('/api/marketing/contacts/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ batch_id: batch.id, contacts }),
    })
    const data = await res.json() as { ok?: boolean; inserted?: number; error?: string }
    if (!res.ok || !data.ok) { setError(data.error ?? 'Import failed'); setImporting(false); return }
    onDone(data.inserted ?? 0)
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
              <div className="mt-1 text-xs text-slate-400">Name, Email, Phone, Company, City…</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">{rows.length} rows — map columns</div>
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
              <button onClick={doImport} disabled={importing} className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{importing ? 'Importing…' : `Import ${rows.length}`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Overview ────────────────────────────────────────────────────────────

function OverviewTab({ batches, contacts, loading, onRefresh, onTabChange }: {
  batches: Batch[]; contacts: Contact[]; loading: boolean; onRefresh: () => void; onTabChange: (t: Tab) => void
}) {
  const [newBatch, setNewBatch] = useState(false)
  const [markMailed, setMarkMailed] = useState<Batch | null>(null)
  const [csvBatch, setCsvBatch] = useState<Batch | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const totalMailed = batches.reduce((s, b) => s + (b.total_contacts || 0), 0)
  const totalResponded = batches.reduce((s, b) => s + (b.responded_count || 0), 0)
  const totalPartners = batches.reduce((s, b) => s + (b.partner_count || 0), 0)
  const needsReply = contacts.filter(c => c.sequence_paused && !c.decision)

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>
      )}

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

      {needsReply.length > 0 && (
        <button onClick={() => onTabChange('pipeline')}
          className="w-full rounded-[20px] border-2 border-amber-300 bg-amber-50 p-4 text-left hover:bg-amber-100 transition">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔔</span>
              <div>
                <div className="font-semibold text-amber-800">{needsReply.length} contact{needsReply.length !== 1 ? 's' : ''} responded — ready for follow-up</div>
                <div className="mt-0.5 text-xs text-amber-600">{needsReply.slice(0, 3).map(c => c.name).join(', ')}{needsReply.length > 3 ? ` +${needsReply.length - 3} more` : ''}</div>
              </div>
            </div>
            <span className="text-sm font-semibold text-amber-700">Open Pipeline →</span>
          </div>
        </button>
      )}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#1a2744]">Batches</h2>
          <button onClick={() => setNewBatch(true)} className="rounded-xl bg-[#f5a623] px-4 py-2 text-sm font-semibold text-[#1a2744] hover:brightness-95 transition">+ New Batch</button>
        </div>

        {loading ? (
          <div className="rounded-[20px] border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : batches.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-slate-300 bg-white p-10 text-center">
            <div className="text-3xl">📬</div>
            <div className="mt-3 text-sm font-semibold text-slate-600">No batches yet</div>
            <button onClick={() => setNewBatch(true)} className="mt-4 rounded-xl bg-[#1a2744] px-5 py-2 text-sm font-semibold text-white">+ New Batch</button>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map(batch => {
              const mailed = !!batch.mail_sent_date
              const emailDate = mailed ? addDays(batch.mail_sent_date!, batch.email_delay_days ?? 10) : null
              const smsDate = emailDate ? addDays(emailDate, batch.sms_delay_days ?? 5) : null
              const emailDays = emailDate ? daysUntil(emailDate) : null
              const smsDays = smsDate ? daysUntil(smsDate) : null
              return (
                <div key={batch.id} className="rounded-[22px] border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#1a2744]">{batch.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${batch.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{batch.status}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                        {batch.industry && <span>{batch.industry}</span>}
                        {batch.city && <span>{batch.city}</span>}
                        <span>{batch.total_contacts} contacts</span>
                        {batch.responded_count > 0 && <span className="text-violet-600">{batch.responded_count} responded</span>}
                        {batch.partner_count > 0 && <span className="text-emerald-600">{batch.partner_count} partners</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 items-end">
                      {!mailed && batch.total_contacts > 0 && (
                        <button onClick={() => setMarkMailed(batch)} className="rounded-xl bg-[#f5a623] px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:brightness-95">Mark Mailed</button>
                      )}
                      <button onClick={() => setCsvBatch(batch)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">+ Import</button>
                    </div>
                  </div>
                  {mailed && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-[14px] bg-slate-50 p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mailed</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{fmtDate(batch.mail_sent_date)}</div>
                      </div>
                      <div className={`rounded-[14px] p-3 ${emailDays !== null && emailDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">✉️ Email</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{emailDays !== null && emailDays <= 0 ? '✅ Sent' : fmtDate(emailDate)}</div>
                        {emailDays !== null && emailDays > 0 && <div className="text-[10px] text-amber-600 font-semibold">in {emailDays}d</div>}
                      </div>
                      <div className={`rounded-[14px] p-3 ${smsDays !== null && smsDays <= 0 ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">💬 SMS</div>
                        <div className="mt-1 text-sm font-semibold text-[#1a2744]">{smsDays !== null && smsDays <= 0 ? '✅ Sent' : fmtDate(smsDate)}</div>
                        {smsDays !== null && smsDays > 0 && <div className="text-[10px] text-amber-600 font-semibold">in {smsDays}d</div>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {newBatch && <NewBatchModal onClose={() => setNewBatch(false)} onDone={b => { setNewBatch(false); onRefresh(); showToast(`Batch "${b.name}" created`) }} />}
      {markMailed && <MarkMailedModal batch={markMailed} onClose={() => setMarkMailed(null)} onDone={() => { setMarkMailed(null); onRefresh(); showToast('Sequence timer started') }} />}
      {csvBatch && <CsvImportModal batch={csvBatch} onClose={() => setCsvBatch(null)} onDone={n => { setCsvBatch(null); onRefresh(); showToast(`${n} contacts imported`) }} />}
    </div>
  )
}

// ─── Tab: Lists ───────────────────────────────────────────────────────────────

function ListsTab({ contacts, onSelectContact }: { contacts: Contact[]; onSelectContact: (c: Contact) => void }) {
  const [lists, setLists] = useState<List[]>([])
  const [selectedList, setSelectedList] = useState<List | null>(null)
  const [listContacts, setListContacts] = useState<Contact[]>([])
  const [loadingContacts, setLoadingContacts] = useState(false)
  const [showNewList, setShowNewList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListTier, setNewListTier] = useState<string>('')
  const [savingList, setSavingList] = useState(false)
  const [search, setSearch] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    fetch('/api/marketing/lists', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setLists(Array.isArray(d) ? d : []))
  }, [])

  async function loadListContacts(list: List) {
    setSelectedList(list)
    setLoadingContacts(true)
    const data = await fetch(`/api/marketing/lists/${list.id}/contacts`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
    setListContacts(Array.isArray(data) ? data : [])
    setLoadingContacts(false)
  }

  async function createList() {
    if (!newListName.trim()) return
    setSavingList(true)
    const res = await fetch('/api/marketing/lists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name: newListName.trim(), tier: newListTier ? Number(newListTier) : null }),
    })
    const data = await res.json() as { ok?: boolean; list?: List }
    if (data.ok && data.list) setLists(prev => [{ ...data.list!, contact_count: 0 }, ...prev])
    setNewListName(''); setNewListTier(''); setShowNewList(false); setSavingList(false)
  }

  async function deleteList(id: string) {
    if (!confirm('Delete this list?')) return
    await fetch(`/api/marketing/lists?id=${id}`, { method: 'DELETE', credentials: 'include' })
    setLists(prev => prev.filter(l => l.id !== id))
    if (selectedList?.id === id) { setSelectedList(null); setListContacts([]) }
  }

  async function addContactToList(contact: Contact) {
    if (!selectedList) return
    await fetch(`/api/marketing/lists/${selectedList.id}/contacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: [contact.id] }),
    })
    setListContacts(prev => prev.some(c => c.id === contact.id) ? prev : [contact, ...prev])
    setLists(prev => prev.map(l => l.id === selectedList.id ? { ...l, contact_count: l.contact_count + 1 } : l))
    setAddSearch('')
    showToast(`${contact.name} added`)
  }

  async function removeContactFromList(contactId: string) {
    if (!selectedList) return
    await fetch(`/api/marketing/lists/${selectedList.id}/contacts`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: contactId }),
    })
    setListContacts(prev => prev.filter(c => c.id !== contactId))
    setLists(prev => prev.map(l => l.id === selectedList.id ? { ...l, contact_count: Math.max(0, l.contact_count - 1) } : l))
  }

  const tierColors: Record<number, string> = { 1: 'bg-amber-100 text-amber-800', 2: 'bg-sky-100 text-sky-700', 3: 'bg-slate-100 text-slate-600' }
  const addSuggestions = addSearch.length > 1
    ? contacts.filter(c => !listContacts.some(lc => lc.id === c.id) && (
        c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
        (c.company ?? '').toLowerCase().includes(addSearch.toLowerCase())
      )).slice(0, 6)
    : []

  return (
    <div className="flex gap-5 h-[calc(100vh-240px)] min-h-[480px]">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}

      {/* Left: list directory */}
      <div className="w-64 shrink-0 flex flex-col rounded-[22px] border border-slate-200 bg-white overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-[#1a2744]">Lists</span>
            <button onClick={() => setShowNewList(v => !v)} className="rounded-lg bg-[#1a2744] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#243560]">+ New</button>
          </div>
          {showNewList && (
            <div className="space-y-2">
              <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="List name…" autoFocus
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
              <select value={newListTier} onChange={e => setNewListTier(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none">
                <option value="">No tier</option>
                <option value="1">Tier 1 — High freq</option>
                <option value="2">Tier 2 — Commercial</option>
                <option value="3">Tier 3 — Community</option>
              </select>
              <button onClick={createList} disabled={savingList || !newListName.trim()}
                className="w-full rounded-xl bg-[#1a2744] py-2 text-xs font-semibold text-white disabled:opacity-40">{savingList ? 'Creating…' : 'Create'}</button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {lists.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No lists yet.</div>
          ) : lists.map(list => (
            <button key={list.id} onClick={() => loadListContacts(list)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition ${selectedList?.id === list.id ? 'bg-slate-50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[#1a2744] truncate">{list.name}</span>
                <div className="flex items-center gap-1">
                  {list.tier && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${tierColors[list.tier]}`}>T{list.tier}</span>}
                  <button onClick={e => { e.stopPropagation(); deleteList(list.id) }}
                    className="rounded px-1 text-slate-300 hover:text-rose-500 text-xs">✕</button>
                </div>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">{list.contact_count} contacts</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: contacts in list */}
      <div className="flex-1 flex flex-col rounded-[22px] border border-slate-200 bg-white overflow-hidden">
        {!selectedList ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="text-3xl">📋</div>
              <div className="mt-3 text-sm font-medium">Select a list</div>
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#1a2744]">{selectedList.name}</div>
                  <div className="text-xs text-slate-400">{listContacts.length} contacts</div>
                </div>
                <div className="relative flex-1 max-w-xs">
                  <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Add contact by name…"
                    className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
                  {addSuggestions.length > 0 && (
                    <div className="absolute top-10 left-0 right-0 z-10 rounded-[14px] border border-slate-200 bg-white shadow-lg">
                      {addSuggestions.map(c => (
                        <button key={c.id} onClick={() => addContactToList(c)}
                          className="w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                          <div className="font-medium text-[#1a2744]">{c.name}</div>
                          <div className="text-xs text-slate-400">{c.company ?? c.industry ?? ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter list…"
                className="mt-3 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingContacts ? (
                <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
              ) : listContacts.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400">No contacts in this list. Search above to add one.</div>
              ) : listContacts
                .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase()))
                .map(c => (
                  <div key={c.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectContact(c)}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-[#1a2744] truncate">{c.name}</span>
                        <TierBadge tier={c.outreach_tier} />
                      </div>
                      <div className="text-xs text-slate-400 truncate">{c.company ?? c.industry ?? ''} {c.city ? `· ${c.city}` : ''}</div>
                    </div>
                    <StageBadge stage={(c as Contact & { normalized_stage: string }).normalized_stage ?? c.stage ?? ''} />
                    <button onClick={() => removeContactFromList(c.id)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition">Remove</button>
                  </div>
                ))
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Pipeline ────────────────────────────────────────────────────────────

const PIPELINE_COLS = [
  { key: 'connected', label: '💬 Engaged', color: 'bg-violet-50 border-violet-200' },
  { key: 'qualified', label: '🗣 Qualified', color: 'bg-orange-50 border-orange-200' },
  { key: 'partnership_active', label: '✅ Active', color: 'bg-emerald-50 border-emerald-200' },
  { key: 'dormant', label: '❄️ Nurture', color: 'bg-slate-50 border-slate-200' },
]

function PipelineTab({ contacts, onSelect, onStageChange }: {
  contacts: Contact[]
  onSelect: (c: Contact) => void
  onStageChange: (id: string, stage: string) => Promise<void>
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [tierFilter, setTierFilter] = useState<number | null>(null)

  const responded = contacts.filter(c => c.sequence_paused)
  const filtered = tierFilter ? responded.filter(c => c.outreach_tier === tierFilter) : responded

  if (responded.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white p-16 text-center">
        <div className="text-4xl">📭</div>
        <div className="mt-4 text-base font-semibold text-[#1a2744]">No responses yet</div>
        <div className="mt-2 text-sm text-slate-500">People who reply show up here.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#1a2744]">Relationship Pipeline</h2>
          <p className="text-sm text-slate-500">{filtered.length} contact{filtered.length !== 1 ? 's' : ''} in play</p>
        </div>
        <div className="flex gap-1.5">
          {[null, 1, 2, 3].map(t => (
            <button key={t ?? 'all'} onClick={() => setTierFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${tierFilter === t ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {t ? `Tier ${t}` : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PIPELINE_COLS.map(col => {
          const colContacts = filtered.filter(c => c.normalized_stage === col.key)
          return (
            <div key={col.key}
              onDragOver={e => { e.preventDefault(); if (draggingId) setDropTarget(col.key) }}
              onDragLeave={e => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setDropTarget(curr => curr === col.key ? null : curr) }}
              onDrop={e => {
                e.preventDefault()
                const contactId = e.dataTransfer.getData('text/plain') || draggingId
                setDropTarget(null); setDraggingId(null)
                if (!contactId) return
                const curr = responded.find(c => c.id === contactId)
                if (!curr || curr.normalized_stage === col.key) return
                setMovingId(contactId)
                void onStageChange(contactId, col.key).finally(() => setMovingId(id => id === contactId ? null : id))
              }}
              className={`rounded-[22px] border p-4 transition ${col.color} ${dropTarget === col.key ? 'ring-2 ring-[#1a2744] ring-offset-2 ring-offset-white' : ''}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">{col.label}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{colContacts.length}</span>
              </div>
              <div className="space-y-2">
                {colContacts.length === 0 ? (
                  <div className={`rounded-[14px] border border-dashed border-slate-200 bg-white/50 p-4 text-center text-xs text-slate-400 transition ${dropTarget === col.key ? 'border-[#1a2744] bg-white text-[#1a2744]' : ''}`}>Drop here</div>
                ) : colContacts.map(c => (
                  <div key={c.id} role="button" tabIndex={0} draggable
                    onClick={() => onSelect(c)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c) } }}
                    onDragStart={e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(c.id) }}
                    onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                    className={`w-full rounded-[16px] border border-white bg-white p-3 text-left shadow-sm transition hover:shadow-md ${draggingId === c.id ? 'cursor-grabbing opacity-50' : 'cursor-grab'} ${movingId === c.id ? 'pointer-events-none opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="text-sm font-semibold text-[#1a2744] truncate">{c.name}</div>
                      <TierBadge tier={c.outreach_tier} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                      <span>{c.city ?? ''}</span>
                      {movingId === c.id ? <span>Saving…</span> : c.last_touch_at && <span>{timeAgo(c.last_touch_at)}</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      {c.instantly_status && <InstantlyBadge status={c.instantly_status} />}
                      {c.decision && (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.decision === 'agreed' ? 'bg-emerald-100 text-emerald-700' : c.decision === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                          {c.decision}
                        </span>
                      )}
                    </div>
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

// ─── Tab: Phone ───────────────────────────────────────────────────────────────

const PARTNERSHIP_FROM_NUMBER = '+12267746581'

function PhoneTab({ contacts, lists, onSelectContact }: { contacts: Contact[]; lists: List[]; onSelectContact: (c: Contact) => void }) {
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
  const dialer = useDialer()

  const sorted = [...contacts]
    .sort((a, b) => (b.last_touch_at ?? '').localeCompare(a.last_touch_at ?? ''))
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase()))

  const selected = contacts.find(c => c.id === selectedId) ?? null
  const selectedFromQuery = searchParams.get('contact')

  useEffect(() => {
    if (selectedFromQuery && contacts.some(c => c.id === selectedFromQuery)) {
      setSelectedId(curr => curr === selectedFromQuery ? curr : selectedFromQuery)
    } else if (!selectedId && sorted[0]) {
      setSelectedId(sorted[0].id)
    }
  }, [contacts, selectedFromQuery, selectedId, sorted])

  useEffect(() => {
    if (!selectedId) return
    setTouches([]); setTouchLoading(true)
    fetch(`/api/marketing/touches?contact_id=${selectedId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setTouches(Array.isArray(d) ? d : []))
      .finally(() => setTouchLoading(false))
  }, [selectedId])

  useEffect(() => {
    if (!selected) return
    const first = selected.name.split(' ')[0] || 'there'
    setSmsBody(`Hi ${first}, Eric from Saturn Star Movers. Following up on the letter we sent to ${selected.company || 'you'} — open to a quick call?`)
    setEmailSubject('Partnership Opportunity — Saturn Star Moving')
    setEmailBody(`Hi ${first},\n\nFollowing up on the letter we sent to ${selected.company || 'your team'} about a partnership with Saturn Star Moving.\n\nWould you be open to a quick 10-minute call?\n\nEric\nHead of Partnerships | Saturn Star Movers\n+1 (226) 774-6581`)
  }, [selected?.id])

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight }, [touches])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleSelect(id: string) {
    setSelectedId(id)
    router.replace(`/marketing/partners?tab=phone&contact=${id}`, { scroll: false })
  }

  async function handleSend() {
    if (!selected) return
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
      fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(d => setTouches(Array.isArray(d) ? d : []))
    } catch { showToast('Send failed') }
    setSending(false)
  }

  async function handleCall() {
    if (!selected?.phone) return
    await dialer.call(selected.phone)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: selected.id, channel: 'phone', direction: 'outbound', notes: 'Outbound call via partnership dialer', schedule_follow_up_days: 2 }),
    })
  }

  const preview = selected ? getContactPreview(selected) : null

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[520px] rounded-[24px] border border-slate-200 bg-white overflow-hidden">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}

      {/* Contact list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200">
        <div className="p-3 border-b border-slate-100">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {sorted.map(c => {
            const unread = c.needs_follow_up || (c.sequence_paused && !c.decision)
            const p = getContactPreview(c)
            return (
              <button key={c.id} onClick={() => handleSelect(c.id)}
                className={`w-full px-4 py-3 text-left border-b border-slate-100 transition hover:bg-slate-50 ${selectedId === c.id ? 'bg-[#1a2744]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`font-semibold text-sm truncate ${selectedId === c.id ? 'text-white' : 'text-[#1a2744]'}`}>{c.name}</span>
                    <TierBadge tier={c.outreach_tier} />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {unread && selectedId !== c.id && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                    <span className={`text-[10px] ${selectedId === c.id ? 'text-white/60' : 'text-slate-400'}`}>{timeAgo(c.last_touch_at)}</span>
                  </div>
                </div>
                <div className={`mt-0.5 text-xs truncate ${selectedId === c.id ? 'text-white/70' : 'text-slate-400'}`}>{c.company ?? c.industry ?? c.city ?? '—'}</div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <StageBadge stage={c.normalized_stage} />
                  {c.instantly_status && <InstantlyBadge status={c.instantly_status} />}
                </div>
                {p?.body && <div className={`mt-1.5 text-[11px] leading-4 ${selectedId === c.id ? 'text-white/70' : 'text-slate-500'}`}>{truncateText(p.body, 80)}</div>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail panel */}
      {!selected ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <div className="text-center"><div className="text-4xl">📱</div><div className="mt-3 text-sm font-medium">Select a contact</div></div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white">{selected.name.charAt(0)}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#1a2744]">{selected.name}</span>
                  <TierBadge tier={selected.outreach_tier} />
                  <StageBadge stage={selected.normalized_stage} />
                  {selected.sequence_paused && !selected.decision && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Responded</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  {selected.company && <span>{selected.company}</span>}
                  {selected.city && <span>{selected.city}</span>}
                  {selected.phone && <span>{selected.phone}</span>}
                </div>
                {preview && <div className="mt-1 text-xs text-slate-500">{truncateText(preview.body ?? '', 100)}</div>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={() => onSelectContact(selected)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Profile</button>
              {selected.phone && (
                dialer.status === 'connected' ? (
                  <button onClick={dialer.hangup} className="flex items-center gap-1.5 rounded-xl bg-rose-500 px-3 py-2 text-sm font-semibold text-white">🔴 End Call</button>
                ) : (
                  <button onClick={handleCall} disabled={dialer.status === 'connecting' || dialer.status === 'loading'}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                    {dialer.status === 'connecting' || dialer.status === 'loading' ? '⏳ Connecting…' : '📞 Dial'}
                  </button>
                )
              )}
              {selected.sequence_paused && !selected.decision && (
                <button onClick={() => setShowDecision(true)} className="rounded-xl bg-[#1a2744] px-3 py-2 text-sm font-semibold text-white hover:bg-[#243560]">Log Decision</button>
              )}
            </div>
          </div>

          {/* Thread */}
          <div ref={threadRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50">
            {touchLoading && <div className="text-center text-xs text-slate-400 py-8">Loading…</div>}
            {!touchLoading && touches.length === 0 && <div className="text-center text-xs text-slate-400 py-8">No history yet.</div>}
            {[...touches].reverse().map(touch => {
              const s = summarizeTouch(touch.channel, touch.direction, touch.notes)
              return (
                <div key={touch.id} className={`flex gap-3 ${touch.direction === 'outbound' ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${touch.direction === 'outbound' ? 'bg-[#1a2744]' : 'bg-white border border-slate-200'}`}>
                    <ChannelIcon channel={touch.channel} direction={touch.direction} />
                  </div>
                  <div className={`max-w-[70%] rounded-[16px] px-4 py-2.5 text-sm ${touch.direction === 'outbound' ? 'bg-[#1a2744] text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-[#1a2744] rounded-tl-sm'}`}>
                    <div className={`mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${touch.direction === 'outbound' ? 'text-white/70' : 'text-slate-400'}`}>
                      {s.label}
                      {s.auto && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${touch.direction === 'outbound' ? 'bg-white/15 text-white/90' : 'bg-slate-100 text-slate-500'}`}>Auto</span>}
                    </div>
                    {s.body && <div className="whitespace-pre-wrap leading-relaxed">{s.body}</div>}
                    <div className={`mt-1 text-[10px] ${touch.direction === 'outbound' ? 'text-white/50' : 'text-slate-400'}`}>{fmtDate(touch.created_at)} {fmtTime(touch.created_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Compose */}
          <div className="border-t border-slate-200 bg-white px-5 py-4">
            <div className="mb-3 flex gap-2">
              <button onClick={() => setComposeChannel('sms')} className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${composeChannel === 'sms' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                💬 SMS {!selected.phone && <span className="ml-1 text-red-400">no #</span>}
              </button>
              <button onClick={() => setComposeChannel('email')} className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${composeChannel === 'email' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                ✉️ Email {!selected.email && <span className="ml-1 text-red-400">no email</span>}
              </button>
            </div>
            {composeChannel === 'sms' ? (
              <div className="flex gap-2">
                <textarea value={smsBody} onChange={e => setSmsBody(e.target.value)} rows={2} placeholder={selected.phone ? 'Type SMS…' : 'No phone'} disabled={!selected.phone}
                  className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40" />
                <button onClick={handleSend} disabled={sending || !selected.phone || !smsBody.trim()}
                  className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{sending ? '…' : 'Send'}</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                  className="h-9 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
                <div className="flex gap-2">
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3} placeholder={selected.email ? 'Type email…' : 'No email'} disabled={!selected.email}
                    className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40" />
                  <button onClick={handleSend} disabled={sending || !selected.email || !emailBody.trim()}
                    className="self-end rounded-[14px] bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{sending ? '…' : 'Send'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showDecision && selected && (
        <DecisionModal contact={selected} onClose={() => setShowDecision(false)}
          onDone={() => { setShowDecision(false); fetch(`/api/marketing/touches?contact_id=${selected.id}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(d => setTouches(Array.isArray(d) ? d : [])) }} />
      )}
    </div>
  )
}

// ─── Tab: Active Partners ─────────────────────────────────────────────────────

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
        <p className="text-sm text-slate-500">{partners.length} active</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {partners.map(c => {
          const daysSince = c.last_touch_at ? Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) : null
          const warm = daysSince !== null && daysSince <= 30
          return (
            <button key={c.id} onClick={() => onSelect(c)}
              className={`rounded-[22px] border bg-white p-5 text-left hover:shadow-md transition ${!warm ? 'border-amber-300' : 'border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{c.name.charAt(0)}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[#1a2744] truncate">{c.name}</span>
                    <TierBadge tier={c.outreach_tier} />
                  </div>
                  <div className="text-xs text-slate-500 truncate">{c.company ?? c.industry ?? ''}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                {c.phone && <div className="rounded-[10px] bg-slate-50 p-2"><div className="text-[9px] font-semibold uppercase text-slate-400">Phone</div><div className="mt-0.5 font-medium text-[#1a2744]">{c.phone}</div></div>}
                {c.email && <div className="rounded-[10px] bg-slate-50 p-2 col-span-2 truncate"><div className="text-[9px] font-semibold uppercase text-slate-400">Email</div><div className="mt-0.5 font-medium text-[#1a2744] truncate">{c.email}</div></div>}
                <div className="rounded-[10px] bg-slate-50 p-2">
                  <div className="text-[9px] font-semibold uppercase text-slate-400">Last Touch</div>
                  <div className={`mt-0.5 font-medium ${!warm ? 'text-amber-600' : 'text-[#1a2744]'}`}>{daysSince !== null ? `${daysSince}d ago` : '—'}{!warm && ' ⚠️'}</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'lists' | 'pipeline' | 'phone' | 'partners'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'lists', label: 'Lists', icon: '📋' },
  { key: 'pipeline', label: 'Pipeline', icon: '🎯' },
  { key: 'phone', label: 'Phone', icon: '📱' },
  { key: 'partners', label: 'Partners', icon: '🤝' },
]

function PartnershipEngineInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'overview')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const r = await fetch('/api/marketing/contacts?limit=500&offset=0', { credentials: 'include' })
    if (r.ok) { const d = await r.json() as { contacts?: Contact[] }; setContacts(d.contacts ?? []) }
    setContactsLoading(false)
  }, [])

  const loadBatches = useCallback(async () => {
    setBatchesLoading(true)
    const r = await fetch('/api/marketing/batches', { credentials: 'include' })
    if (r.ok) setBatches(await r.json() as Batch[])
    setBatchesLoading(false)
  }, [])

  const loadLists = useCallback(async () => {
    const r = await fetch('/api/marketing/lists', { credentials: 'include' })
    if (r.ok) setLists(await r.json() as List[])
  }, [])

  useEffect(() => { void loadContacts() }, [loadContacts])
  useEffect(() => { void loadBatches() }, [loadBatches])
  useEffect(() => { void loadLists() }, [loadLists])

  function handleTabChange(t: Tab) {
    setTab(t)
    router.replace(`/marketing/partners?tab=${t}`, { scroll: false })
  }

  async function handlePipelineStageChange(contactId: string, stage: string) {
    const prev = contacts
    setContacts(curr => curr.map(c => c.id === contactId ? { ...c, stage, normalized_stage: stage, last_touch_at: new Date().toISOString() } : c))
    const res = await fetch('/api/marketing/contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ id: contactId, stage }),
    })
    if (!res.ok) { setContacts(prev); return }
    const data = await res.json().catch(() => null) as { contact?: Partial<Contact> } | null
    if (data?.contact) {
      setContacts(curr => curr.map(c => c.id === contactId ? { ...c, ...data.contact, normalized_stage: String(data.contact!.stage || stage) } : c))
    }
  }

  const needsReplyCount = contacts.filter(c => c.sequence_paused && !c.decision).length

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1a2744]">Partnership Engine</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {batchesLoading ? '—' : batches.length} batch{batches.length !== 1 ? 'es' : ''} · {contactsLoading ? '—' : contacts.length} contacts
              {needsReplyCount > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{needsReplyCount} need reply</span>}
            </p>
          </div>
        </div>

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

        {tab === 'overview' && (
          <OverviewTab batches={batches} contacts={contacts} loading={batchesLoading || contactsLoading}
            onRefresh={() => { void loadBatches(); void loadContacts() }} onTabChange={handleTabChange} />
        )}
        {tab === 'lists' && (
          <ListsTab contacts={contacts} onSelectContact={setSelectedContact} />
        )}
        {tab === 'pipeline' && (
          <PipelineTab contacts={contacts} onSelect={setSelectedContact} onStageChange={handlePipelineStageChange} />
        )}
        {tab === 'phone' && (
          <PhoneTab contacts={contacts} lists={lists} onSelectContact={setSelectedContact} />
        )}
        {tab === 'partners' && (
          <PartnersTab contacts={contacts} onSelect={setSelectedContact} />
        )}

        {selectedContact && (
          <ContactDrawer
            contact={selectedContact}
            lists={lists}
            onClose={() => setSelectedContact(null)}
            onRefresh={() => { void loadContacts(); void loadBatches() }}
          />
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
