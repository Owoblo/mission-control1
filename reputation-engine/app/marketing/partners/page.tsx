'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { PARTNERSHIP_STAGE_META } from '@/lib/marketing'
import { sendSalesMessage } from '@/lib/sales-api'
import { PARTNER_CATEGORIES, CATEGORY_LIST, SERVICE_AREAS, suggestBatchName, getCategoryMeta } from '@/lib/partner-categories'

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
  sms_jobs_total?: number
  sms_sent_total?: number
  sms_pending_total?: number
  sms_sent_today?: number
  sms_pending_today?: number
  sms_failed_total?: number
  sms_cancelled_total?: number
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
  affiliate_partner_id?: string | null
  category?: string | null
}

interface Touch {
  id: string
  contact_id?: string
  channel: string
  direction: string
  notes: string | null
  created_by?: string | null
  created_at: string
  outcome_code: string | null
  next_step: string | null
  metadata: Record<string, unknown> | null
}

interface ReplyItem {
  contact: Contact
  latest_touch: Touch
  bucket: 'needs_reply' | 'postcard' | 'appointment' | 'opt_out' | 'closed' | 'review'
  needs_response: boolean
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

interface PartnershipSmsPreview {
  ok?: boolean
  dry_run?: boolean
  total_input: number
  usable_with_phone: number
  no_primary_phone: number
  invalid_phone: number
  existing_phone_matches: number
  existing_exact_name_matches: number
  existing_skipped_no_repeat: number
  duplicate_in_file: number
  would_insert: number
  would_schedule: number
  days_to_finish: number
  sender_numbers: string[]
  timezone: string
  start_hour: number
  end_hour: number
  preview?: Array<{
    name: string
    phone: string
    city: string | null
    scheduled_at: string | null
    from_number: string | null
    message: string
  }>
  error?: string
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

function parseBatchNotes(notes?: string | null) {
  if (!notes) return null
  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
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
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...data] = rows.filter(r => r.some(cell => cell.trim()))
  if (!header) return []
  const headers = header.map(h => h.trim())
  return data.map(values => Object.fromEntries(headers.map((key, index) => [key, (values[index] || '').trim()])))
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

function CategoryBadge({ categoryId }: { categoryId?: string | null }) {
  const meta = getCategoryMeta(categoryId)
  if (!meta) return null
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  )
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
  const [affiliateInfo, setAffiliateInfo] = useState<{ portalUrl: string; isNew: boolean } | null>(null)
  const [activatingAffiliate, setActivatingAffiliate] = useState(false)
  const [copiedPortal, setCopiedPortal] = useState(false)

  async function activateAffiliate() {
    setActivatingAffiliate(true)
    try {
      const res = await fetch(`/api/marketing/contacts/${contact.id}/decide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ decision: 'agreed', notes: 'Activated via contact drawer' }),
      })
      const data = await res.json() as { ok?: boolean }
      if (data.ok) {
        // Poll briefly for affiliate info
        await new Promise(r => setTimeout(r, 1200))
        const contactRes = await fetch(`/api/marketing/contacts?q=${encodeURIComponent(contact.name)}&limit=1`, { credentials: 'include' })
        const cData = await contactRes.json() as { contacts?: Array<{ affiliate_partner_id?: string }> }
        const partnerId = cData.contacts?.[0]?.affiliate_partner_id
        if (partnerId) {
          const appUrl = window.location.origin
          setAffiliateInfo({ portalUrl: `${appUrl}/affiliate?token=`, isNew: true })
        }
        onRefresh()
      }
    } finally {
      setActivatingAffiliate(false)
    }
  }

  // Load affiliate info if contact is already active
  useEffect(() => {
    if (contact.affiliate_partner_id) {
      fetch(`/api/sales/affiliate-partners`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then((partners: Array<{ id: string; portalUrl: string | null }>) => {
          const p = partners.find(x => x.id === contact.affiliate_partner_id)
          if (p?.portalUrl) setAffiliateInfo({ portalUrl: p.portalUrl, isNew: false })
        }).catch(() => {})
    }
  }, [contact.affiliate_partner_id])

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
            {(contact.normalized_stage === 'partnership_active' || contact.decision === 'agreed') && (
              affiliateInfo?.portalUrl ? (
                <button
                  onClick={() => { navigator.clipboard.writeText(affiliateInfo.portalUrl); setCopiedPortal(true); setTimeout(() => setCopiedPortal(false), 2000) }}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition">
                  {copiedPortal ? '✓ Copied!' : '🔗 Copy Portal Link'}
                </button>
              ) : !contact.affiliate_partner_id ? (
                <button onClick={() => void activateAffiliate()} disabled={activatingAffiliate}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-50">
                  {activatingAffiliate ? '⏳ Creating portal…' : '🤝 Create Affiliate Portal'}
                </button>
              ) : null
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
  const [category, setCategory] = useState('')
  const [city, setCity] = useState('windsor')
  const [form, setForm] = useState({ name: '', industry: '', city: 'windsor', email_delay_days: 10, sms_delay_days: 5, rep_name: 'Hunter' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-suggest batch name when category + city are selected
  function handleCategoryChange(catId: string) {
    setCategory(catId)
    const suggested = suggestBatchName(city, catId)
    if (suggested) setForm(f => ({ ...f, name: suggested, industry: PARTNER_CATEGORIES[catId]?.label || f.industry }))
  }

  function handleCityChange(cityId: string) {
    setCity(cityId)
    if (category) {
      const suggested = suggestBatchName(cityId, category)
      if (suggested) setForm(f => ({ ...f, name: suggested, city: cityId }))
    } else {
      setForm(f => ({ ...f, city: cityId }))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Batch name required'); return }
    setSaving(true)
    const res = await fetch('/api/marketing/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ ...form, city, category, sequence_type: getCategoryMeta(category)?.tier === 2 ? 'corporate' : 'standard' }),
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

          {/* City + Category — the two most important fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">City *</label>
              <select value={city} onChange={e => handleCityChange(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                {SERVICE_AREAS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Category *</label>
              <select value={category} onChange={e => handleCategoryChange(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]">
                <option value="">— select —</option>
                <optgroup label="Tier 1 — High Frequency">
                  {CATEGORY_LIST.filter(c => c.tier === 1).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
                <optgroup label="Tier 2 — Commercial">
                  {CATEGORY_LIST.filter(c => c.tier === 2).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
                <optgroup label="Tier 3 — Community">
                  {CATEGORY_LIST.filter(c => c.tier === 3).map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Suggested cold call script */}
          {category && PARTNER_CATEGORIES[category] && (
            <div className="rounded-[10px] border border-[#1a2744]/10 bg-[#f8f9fc] px-3 py-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Opening line</div>
              <div className="text-xs text-slate-600 italic">"{PARTNER_CATEGORIES[category].suggestedScript}"</div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500">Batch Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={category && city ? suggestBatchName(city, category) || 'e.g. Windsor Realtors — Q2 2026' : 'e.g. Windsor Realtors — Q2 2026'}
              required className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-[#1a2744] outline-none focus:border-[#1a2744]" />
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
  const FIELDS = ['name', 'company', 'title', 'email', 'phone', 'address', 'city', 'industry', 'website', 'category']

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
              const notes = parseBatchNotes(batch.notes)
              const isSmsCampaign = notes?.type === 'partnership_sms_campaign' || (batch.sms_jobs_total ?? 0) > 0
              const smsTotal = batch.sms_jobs_total ?? 0
              const smsSent = batch.sms_sent_total ?? 0
              const smsPending = batch.sms_pending_total ?? 0
              const smsSentToday = batch.sms_sent_today ?? 0
              const smsPendingToday = batch.sms_pending_today ?? 0
              const smsProgress = smsTotal > 0 ? Math.round((smsSent / smsTotal) * 100) : 0
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
                      {!isSmsCampaign && !mailed && batch.total_contacts > 0 && (
                        <button onClick={() => setMarkMailed(batch)} className="rounded-xl bg-[#f5a623] px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:brightness-95">Mark Mailed</button>
                      )}
                      {!isSmsCampaign && <button onClick={() => setCsvBatch(batch)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">+ Import</button>}
                    </div>
                  </div>
                  {isSmsCampaign && (
                    <div className="mt-4 space-y-3">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--app-accent)] transition-all" style={{ width: `${smsProgress}%` }} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <div className="rounded-[14px] bg-emerald-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Sent today</div>
                          <div className="mt-1 text-xl font-bold text-emerald-800">{smsSentToday}</div>
                        </div>
                        <div className="rounded-[14px] bg-amber-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Left today</div>
                          <div className="mt-1 text-xl font-bold text-amber-800">{smsPendingToday}</div>
                        </div>
                        <div className="rounded-[14px] bg-slate-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sent total</div>
                          <div className="mt-1 text-xl font-bold text-[#1a2744]">{smsSent}</div>
                        </div>
                        <div className="rounded-[14px] bg-slate-50 p-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remaining</div>
                          <div className="mt-1 text-xl font-bold text-[#1a2744]">{smsPending}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{smsProgress}% complete</span>
                        {(batch.sms_failed_total ?? 0) > 0 && <span className="text-rose-600">{batch.sms_failed_total} failed</span>}
                        {(batch.sms_cancelled_total ?? 0) > 0 && <span>{batch.sms_cancelled_total} cancelled/skipped</span>}
                        {typeof notes?.startHour === 'number' && typeof notes?.endHour === 'number' && (
                          <span>Window {notes.startHour}:00-{notes.endHour}:00</span>
                        )}
                      </div>
                    </div>
                  )}
                  {!isSmsCampaign && mailed && (
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
  const fieldVisitContacts = contacts
    .filter(c => c.pipeline_phase === 'field_visit' || (c.sequence_paused_reason ?? '').startsWith('quick_action:drop_cards') || (c.sequence_paused_reason ?? '').startsWith('quick_action:meeting_requested'))
    .sort((a, b) => (a.city || '').localeCompare(b.city || '') || a.name.localeCompare(b.name))
  const fieldVisitCities = Array.from(new Set(fieldVisitContacts.map(c => c.city || 'No city')))

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}

      <div className="rounded-[22px] border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#1a2744]">Field visits</h2>
            <p className="text-xs text-slate-500">{fieldVisitContacts.length} contact{fieldVisitContacts.length !== 1 ? 's' : ''} marked for cards, flyers, or meetings</p>
          </div>
          <div className="hidden text-xs font-semibold text-slate-400 sm:block">{fieldVisitCities.slice(0, 4).join(' · ')}</div>
        </div>
        {fieldVisitContacts.length > 0 ? (
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {fieldVisitContacts.slice(0, 24).map(c => (
              <button key={c.id} onClick={() => onSelectContact(c)}
                className="min-w-[220px] rounded-[16px] border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-[#1a2744] hover:bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#1a2744]">{c.name}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">{c.company || 'No brokerage'}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">{c.city || 'No city'}</span>
                </div>
                {c.latest_inbound_note && <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{c.latest_inbound_note}</div>}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-[16px] border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
            Tap Drop cards or Meeting in the inbox to build this list.
          </div>
        )}
      </div>

      <div className="flex gap-5 h-[calc(100vh-380px)] min-h-[420px]">
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

// ─── Tab: Partnership Replies ────────────────────────────────────────────────

const REPLY_BUCKETS: Array<{ key: ReplyItem['bucket'] | 'all'; label: string }> = [
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'postcard', label: 'Postcard' },
  { key: 'appointment', label: 'Appointment' },
  { key: 'review', label: 'Review' },
  { key: 'opt_out', label: 'Opt-out' },
  { key: 'all', label: 'All' },
]

function replyBucketLabel(bucket: ReplyItem['bucket']) {
  if (bucket === 'postcard') return 'Postcard request'
  if (bucket === 'appointment') return 'Meeting / call'
  if (bucket === 'opt_out') return 'Opt-out'
  if (bucket === 'closed') return 'Closed'
  if (bucket === 'review') return 'Review'
  return 'Needs reply'
}

function replyBucketClass(bucket: ReplyItem['bucket']) {
  if (bucket === 'postcard') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (bucket === 'appointment') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (bucket === 'opt_out' || bucket === 'closed') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (bucket === 'review') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-[rgba(15,106,83,0.16)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
}

function RepliesTab({ onSelectContact, onOpenThread }: {
  onSelectContact: (c: Contact) => void
  onOpenThread: (c: Contact) => void
}) {
  const [items, setItems] = useState<ReplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ReplyItem['bucket'] | 'all'>('needs_reply')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const loadReplies = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/marketing/sms/replies?limit=300', { credentials: 'include' })
    if (r.ok) {
      const d = await r.json() as { responses?: ReplyItem[] }
      const responses = d.responses ?? []
      setItems(responses)
      setSelectedId(curr => curr && responses.some(item => item.contact.id === curr) ? curr : responses[0]?.contact.id ?? null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadReplies() }, [loadReplies])

  function showToast(message: string) {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.bucket !== filter) return false
    if (!search.trim()) return true
    const haystack = `${item.contact.name} ${item.contact.company ?? ''} ${item.contact.city ?? ''} ${item.contact.phone ?? ''} ${item.latest_touch.notes ?? ''}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

  const selected = items.find(item => item.contact.id === selectedId) ?? filtered[0] ?? null
  const counts = REPLY_BUCKETS.reduce<Record<string, number>>((acc, bucket) => {
    acc[bucket.key] = bucket.key === 'all' ? items.length : items.filter(item => item.bucket === bucket.key).length
    return acc
  }, {})

  async function logReplyAction(item: ReplyItem, action: 'postcard' | 'handled' | 'not_interested') {
    setSaving(action)
    const contactId = item.contact.id
    const baseNote = item.latest_touch.notes ? `Latest reply: ${item.latest_touch.notes}` : 'Latest reply handled.'
    const actionConfig = {
      postcard: {
        touch: {
          contact_id: contactId,
          channel: 'direct_mail',
          direction: 'internal',
          notes: `Postcard requested. ${baseNote}`,
          outcome_code: 'postcard_requested',
          next_step: 'Drop or send postcard, then follow up.',
          new_stage: 'qualified',
          schedule_follow_up_days: 3,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'qualified' },
        toast: 'Postcard request logged',
      },
      handled: {
        touch: {
          contact_id: contactId,
          channel: item.latest_touch.channel || 'sms',
          direction: 'internal',
          notes: `Reply handled by rep. ${baseNote}`,
          outcome_code: 'replied_positive',
          next_step: 'Continue manual relationship follow-up.',
          new_stage: 'connected',
          schedule_follow_up_days: 7,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'connected' },
        toast: 'Reply marked handled',
      },
      not_interested: {
        touch: {
          contact_id: contactId,
          channel: item.latest_touch.channel || 'sms',
          direction: 'internal',
          notes: `Marked not interested. ${baseNote}`,
          outcome_code: 'replied_negative',
          next_step: 'Do not continue outreach unless they re-engage.',
          new_stage: 'closed_lost',
          next_follow_up: null,
          metadata: { source: 'partnership_reply_desk' },
        },
        contact: { id: contactId, sequence_paused: false, sequence_paused_reason: null, stage: 'closed_lost', decision: 'rejected' },
        toast: 'Marked not interested',
      },
    }[action]

    try {
      await fetch('/api/marketing/touches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(actionConfig.touch),
      })
      await fetch('/api/marketing/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(actionConfig.contact),
      })
      showToast(actionConfig.toast)
      await loadReplies()
    } catch {
      showToast('Could not save action')
    }
    setSaving(null)
  }

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--app-ink)]">Reply Desk</h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Inbound SMS and email replies from partnership outreach.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search replies…" className="crm-input h-10 w-48 text-sm" />
          <button onClick={() => void loadReplies()} className="crm-button h-10 text-sm">Refresh</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPLY_BUCKETS.map(bucket => (
          <button key={bucket.key} onClick={() => setFilter(bucket.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === bucket.key ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
            {bucket.label}
            {counts[bucket.key] > 0 && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${filter === bucket.key ? 'bg-white/20 text-white' : 'bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>{counts[bucket.key]}</span>}
          </button>
        ))}
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[18px] border border-[var(--app-line)] bg-white">
          <div className="border-b border-[var(--app-line)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">
            {loading ? 'Loading replies' : `${filtered.length} visible replies`}
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {!loading && filtered.length === 0 && (
              <div className="p-8 text-center text-sm text-[var(--app-muted)]">No replies in this bucket.</div>
            )}
            {filtered.map(item => (
              <button key={`${item.contact.id}-${item.latest_touch.id}`} onClick={() => setSelectedId(item.contact.id)}
                className={`w-full border-b border-[var(--app-line)] px-4 py-3 text-left transition hover:bg-[var(--app-wash)] ${selected?.contact.id === item.contact.id ? 'bg-[var(--app-accent-soft)]' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{item.contact.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{item.contact.company || item.contact.city || item.contact.phone || 'No company'}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${replyBucketClass(item.bucket)}`}>{replyBucketLabel(item.bucket)}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{item.latest_touch.notes || 'No message body saved.'}</div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--app-muted)]">
                  <span>{String(item.latest_touch.channel || 'reply').toUpperCase()}</span>
                  <span>{timeAgo(item.latest_touch.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[18px] border border-[var(--app-line)] bg-white p-5">
          {!selected ? (
            <div className="flex h-full min-h-[420px] items-center justify-center text-center text-sm text-[var(--app-muted)]">Select a reply.</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-[var(--app-ink)]">{selected.contact.name}</h3>
                    <StageBadge stage={selected.contact.normalized_stage} />
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${replyBucketClass(selected.bucket)}`}>{replyBucketLabel(selected.bucket)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--app-muted)]">
                    {selected.contact.company && <span>{selected.contact.company}</span>}
                    {selected.contact.city && <span>{selected.contact.city}</span>}
                    {selected.contact.phone && <span>{selected.contact.phone}</span>}
                    {selected.contact.email && <span>{selected.contact.email}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => onOpenThread(selected.contact)} className="crm-button text-sm">Open thread</button>
                  <button onClick={() => onSelectContact(selected.contact)} className="crm-button text-sm">Profile</button>
                </div>
              </div>

              <div className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">
                  <span>Latest inbound {selected.latest_touch.channel}</span>
                  <span>{fmtDateTime(selected.latest_touch.created_at)}</span>
                </div>
                <div className="whitespace-pre-wrap text-base leading-7 text-[var(--app-ink)]">{selected.latest_touch.notes || 'No message body saved.'}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'postcard')}
                  className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">
                  Mark postcard requested
                </button>
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'handled')}
                  className="rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50">
                  Mark handled
                </button>
                <button disabled={!!saving} onClick={() => void logReplyAction(selected, 'not_interested')}
                  className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                  Not interested
                </button>
              </div>

              <div className="rounded-[14px] border border-[var(--app-line)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">Recommended handling</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Keep the first response human. If they ask for a postcard, log it here, send or drop the card, then use the profile to schedule a follow-up. If they ask to stop, mark not interested so future campaign jobs stay off this contact.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Phone ───────────────────────────────────────────────────────────────

const PARTNERSHIP_FROM_NUMBER = '+12268870667'  // Windsor dedicated outbound number

function getTouchMediaUrls(touch: Touch) {
  const urls = new Set<string>()
  const metadata = touch.metadata || {}
  const candidates = [
    metadata.mediaUrls,
    metadata.media_urls,
    metadata.media,
    metadata.attachments,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      candidate.forEach(item => {
        if (typeof item === 'string') urls.add(item)
        else if (item && typeof item === 'object') {
          const value = (item as Record<string, unknown>).url
          if (typeof value === 'string') urls.add(value)
        }
      })
    }
  }

  const mmsMatch = touch.notes?.match(/\[MMS:\s*([^\]]+)\]/i)
  if (mmsMatch) {
    mmsMatch[1].split(',').map(url => url.trim()).filter(Boolean).forEach(url => urls.add(url))
  }

  return Array.from(urls)
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)
}

function datetimeLocalValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function defaultScheduledReplyTime() {
  const date = new Date()
  date.setSeconds(0, 0)
  if (date.getHours() < 8) {
    date.setHours(8, 0, 0, 0)
  } else {
    date.setDate(date.getDate() + 1)
    date.setHours(8, 0, 0, 0)
  }
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return datetimeLocalValue(date)
}

type InboxQuickAction = 'active_partner' | 'drop_cards' | 'meeting_requested' | 'needs_follow_up' | 'not_interested' | 'wrong_number'

const INBOX_QUICK_ACTIONS: Array<{ key: InboxQuickAction; label: string; tone: 'green' | 'blue' | 'amber' | 'slate' | 'red' }> = [
  { key: 'active_partner', label: 'Active partner', tone: 'green' },
  { key: 'drop_cards', label: 'Drop cards', tone: 'blue' },
  { key: 'meeting_requested', label: 'Meeting', tone: 'blue' },
  { key: 'needs_follow_up', label: 'Follow-up', tone: 'amber' },
  { key: 'not_interested', label: 'Not interested', tone: 'slate' },
  { key: 'wrong_number', label: 'Wrong #', tone: 'red' },
]

function quickActionClass(tone: 'green' | 'blue' | 'amber' | 'slate' | 'red', active: boolean) {
  if (active) return 'border-[#1a2744] bg-[#1a2744] text-white'
  if (tone === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
  if (tone === 'blue') return 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
  if (tone === 'red') return 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
}

function PhoneTab({
  contacts,
  lists,
  onSelectContact,
  onContactUpdated,
}: {
  contacts: Contact[]
  lists: List[]
  onSelectContact: (c: Contact) => void
  onContactUpdated: (c: Contact) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replyContacts, setReplyContacts] = useState<Contact[]>([])
  const [replyLoading, setReplyLoading] = useState(false)
  const [touches, setTouches] = useState<Touch[]>([])
  const [touchLoading, setTouchLoading] = useState(false)
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [composeChannel, setComposeChannel] = useState<'sms' | 'email'>('sms')
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [scheduleMode, setScheduleMode] = useState(false)
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledReplyTime)
  const [sending, setSending] = useState(false)
  const [quickActionSaving, setQuickActionSaving] = useState<InboxQuickAction | null>(null)
  const [sheetUpdateOpen, setSheetUpdateOpen] = useState(false)
  const [sheetInstruction, setSheetInstruction] = useState('')
  const [sheetUpdating, setSheetUpdating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const dialer = useDialer()

  const inboxContacts = useMemo(() => {
    const byId = new Map<string, Contact>()
    contacts.forEach(contact => byId.set(contact.id, contact))
    replyContacts.forEach(contact => byId.set(contact.id, { ...(byId.get(contact.id) || {} as Contact), ...contact }))
    return Array.from(byId.values())
  }, [contacts, replyContacts])

  const sorted = useMemo(() => [...inboxContacts]
    .sort((a, b) => {
      const aNeeds = a.sequence_paused && !a.decision ? 1 : 0
      const bNeeds = b.sequence_paused && !b.decision ? 1 : 0
      if (aNeeds !== bNeeds) return bNeeds - aNeeds
      return (b.latest_inbound_at || b.last_touch_at || '').localeCompare(a.latest_inbound_at || a.last_touch_at || '')
    })
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.company ?? '').toLowerCase().includes(search.toLowerCase())), [inboxContacts, search])

  const selected = inboxContacts.find(c => c.id === selectedId) ?? null
  const selectedFromQuery = searchParams.get('contact')

  useEffect(() => {
    let cancelled = false
    setReplyLoading(true)
    fetch('/api/marketing/sms/replies?limit=500', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { responses: [] })
      .then((data: { responses?: ReplyItem[] }) => {
        if (cancelled) return
        setReplyContacts((data.responses || []).map(item => item.contact))
      })
      .finally(() => { if (!cancelled) setReplyLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedFromQuery && inboxContacts.some(c => c.id === selectedFromQuery)) {
      setSelectedId(curr => curr === selectedFromQuery ? curr : selectedFromQuery)
    } else if (!selectedId && sorted[0]) {
      setSelectedId(sorted[0].id)
    }
  }, [inboxContacts, selectedFromQuery, selectedId, sorted])

  useEffect(() => {
    if (!selectedId) return
    setTouches([]); setTouchLoading(true)
    fetch(`/api/marketing/touches?contact_id=${selectedId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setTouches(Array.isArray(d) ? d : []))
      .finally(() => setTouchLoading(false))
  }, [selectedId])

  const reloadTouches = useCallback((contactId: string) => {
    fetch(`/api/marketing/touches?contact_id=${contactId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setTouches(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) return
    setSmsBody('')
    setEmailSubject('')
    setEmailBody('')
    setMediaUrls([])
    setScheduleMode(false)
    setScheduledAt(defaultScheduledReplyTime())
  }, [selected?.id])

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight }, [touches])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function handleSelect(id: string) {
    setSelectedId(id)
    setMobileListOpen(false)
    router.replace(`/marketing/partners?tab=phone&contact=${id}`, { scroll: false })
  }

  function addMediaUrl() {
    const url = window.prompt('Paste image or video URL')
    if (!url?.trim()) return
    setMediaUrls(current => [...current, url.trim()])
    setComposeChannel('sms')
  }

  async function handleSend() {
    if (!selected) return
    setSending(true)
    try {
      if (composeChannel === 'sms' && scheduleMode) {
        const res = await fetch(`/api/marketing/contacts/${selected.id}/schedule-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            body: smsBody,
            scheduled_at: new Date(scheduledAt).toISOString(),
            from_number: PARTNERSHIP_FROM_NUMBER,
            media_urls: mediaUrls,
          }),
        })
        const data = await res.json().catch(() => null) as { error?: string; scheduled_at?: string } | null
        if (!res.ok) {
          showToast(data?.error || 'Could not schedule SMS')
          return
        }
        showToast('SMS scheduled')
        setSmsBody('')
        setMediaUrls([])
        setScheduleMode(false)
        setScheduledAt(defaultScheduledReplyTime())
        reloadTouches(selected.id)
        return
      }

      await sendSalesMessage(
        composeChannel === 'sms'
          ? { channel: 'sms', to: selected.phone!, body: smsBody || ' ', fromNumber: PARTNERSHIP_FROM_NUMBER, mediaUrls: mediaUrls.length ? mediaUrls : undefined }
          : { channel: 'email', to: selected.email!, subject: emailSubject, body: emailBody }
      )
      const mediaNote = composeChannel === 'sms' && mediaUrls.length ? `\n[MMS: ${mediaUrls.join(', ')}]` : ''
      await fetch('/api/marketing/touches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          contact_id: selected.id, channel: composeChannel, direction: 'outbound',
          notes: composeChannel === 'sms' ? `${smsBody}${mediaNote}`.trim() : `Subject: ${emailSubject}\n\n${emailBody}`,
          metadata: composeChannel === 'sms' && mediaUrls.length ? { mediaUrls } : {},
          schedule_follow_up_days: 3,
        }),
      })
      showToast(composeChannel === 'sms' ? '💬 SMS sent' : '✉️ Email sent')
      setSmsBody('')
      setEmailSubject('')
      setEmailBody('')
      setMediaUrls([])
      reloadTouches(selected.id)
    } catch { showToast('Send failed') }
    finally { setSending(false) }
  }

  async function handleQuickAction(action: InboxQuickAction) {
    if (!selected || quickActionSaving) return
    const config = INBOX_QUICK_ACTIONS.find(item => item.key === action)
    setQuickActionSaving(action)
    try {
      const res = await fetch(`/api/marketing/contacts/${selected.id}/quick-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => null) as { contact?: Contact; label?: string; error?: string } | null
      if (!res.ok || !data?.contact) {
        showToast(data?.error || 'Could not save action')
        return
      }
      const updated = {
        ...selected,
        ...data.contact,
        normalized_stage: String(data.contact.stage || data.contact.normalized_stage || selected.normalized_stage),
      }
      setReplyContacts(curr => {
        const seen = curr.some(c => c.id === updated.id)
        return seen ? curr.map(c => c.id === updated.id ? { ...c, ...updated } : c) : [updated, ...curr]
      })
      onContactUpdated(updated)
      reloadTouches(updated.id)
      showToast(`${data.label || config?.label || 'Action'} saved`)
    } catch {
      showToast('Could not save action')
    } finally {
      setQuickActionSaving(null)
    }
  }

  async function handleSheetUpdate() {
    if (!selected || sheetUpdating || !sheetInstruction.trim()) return
    setSheetUpdating(true)
    try {
      const res = await fetch(`/api/marketing/contacts/${selected.id}/sheet-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instruction: sheetInstruction.trim() }),
      })
      const data = await res.json().catch(() => null) as { error?: string; summary?: string; label?: string } | null
      if (!res.ok) {
        showToast(data?.error || 'Could not update sheet')
        return
      }
      setSheetUpdateOpen(false)
      setSheetInstruction('')
      reloadTouches(selected.id)
      showToast(`Sheet updated for ${selected.name}`)
    } catch {
      showToast('Could not update sheet')
    } finally {
      setSheetUpdating(false)
    }
  }

  async function handleCall() {
    if (!selected?.phone) return
    await dialer.call(selected.phone)
    await fetch('/api/marketing/touches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_id: selected.id, channel: 'phone', direction: 'outbound', notes: 'Outbound call via partnership dialer', schedule_follow_up_days: 2 }),
    })
  }

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-white md:h-[calc(100dvh-210px)] md:min-h-[560px] md:rounded-[18px] md:border md:border-slate-200 lg:h-[calc(100vh-180px)] lg:min-h-[520px] lg:rounded-[24px]">
      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#1a2744] px-5 py-3 text-sm font-medium text-white shadow-xl">{toast}</div>}
      {sheetUpdateOpen && selected && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[20px] border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#1a2744]">Update Sheet</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {selected.name}{selected.company ? ` · ${selected.company}` : ''}
                </p>
              </div>
              <button
                onClick={() => { if (!sheetUpdating) setSheetUpdateOpen(false) }}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100"
              >
                x
              </button>
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Instruction for AI</label>
              <textarea
                value={sheetInstruction}
                onChange={e => setSheetInstruction(e.target.value)}
                rows={7}
                placeholder="Put this partner in the sheet under active partners, scan the text messages and create a summary of where we currently stand."
                className="mt-2 w-full resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-[#1a2744] outline-none focus:border-[#1a2744]"
              />
            </div>
            <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              Nothing updates until you submit this instruction for this partner.
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSheetUpdateOpen(false)}
                disabled={sheetUpdating}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSheetUpdate()}
                disabled={sheetUpdating || !sheetInstruction.trim()}
                className="flex-1 rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {sheetUpdating ? 'Updating...' : 'Submit Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contact list */}
      <div className={`${selected && !mobileListOpen ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-r-0 border-slate-200 lg:w-72 lg:border-r`}>
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="mb-3 text-[22px] font-semibold tracking-tight text-[#1a2744] lg:hidden">Inbox</div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts…"
            className="h-10 w-full rounded-full border border-slate-200 bg-slate-50 px-4 text-base text-[#1a2744] outline-none focus:border-[#1a2744] lg:h-9 lg:text-sm" />
          {replyLoading && <div className="mt-2 text-[11px] text-slate-400">Loading replies...</div>}
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
                {p?.body && <div className={`mt-1.5 text-[12px] leading-5 ${selectedId === c.id ? 'text-white/75' : 'text-slate-600'}`}>{truncateText(p.body, 120)}</div>}
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
        <div className={`${mobileListOpen ? 'hidden lg:flex' : 'flex'} flex-1 flex-col min-w-0`}>
          {/* Header */}
          <div className="border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5 sm:py-4">
            <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <button onClick={() => setMobileListOpen(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-[#1a2744] lg:hidden">
                ‹
              </button>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white sm:h-10 sm:w-10">{selected.name.charAt(0)}</div>
              <div className="min-w-0">
                <div className="truncate font-semibold text-[#1a2744]">{selected.name}</div>
                <div className="mt-0.5 truncate text-xs text-slate-400">{selected.company || selected.phone || selected.city || 'Partner contact'}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selected.phone && (
                dialer.status === 'connected' ? (
                  <button onClick={dialer.hangup} className="h-10 rounded-full bg-rose-500 px-4 text-sm font-semibold text-white">End</button>
                ) : (
                  <button onClick={handleCall} disabled={dialer.status === 'connecting' || dialer.status === 'loading'}
                    className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-[#1a2744] transition hover:bg-slate-50 disabled:opacity-50">
                    {dialer.status === 'connecting' || dialer.status === 'loading' ? 'Calling' : 'Call'}
                  </button>
                )
              )}
              <button onClick={() => onSelectContact(selected)} className="h-10 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Info</button>
            </div>
            </div>
          </div>

          <div className="border-b border-slate-100 bg-white px-3 py-2 sm:px-5">
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              <button
                onClick={() => {
                  setSheetInstruction('')
                  setSheetUpdateOpen(true)
                }}
                disabled={sheetUpdating}
                className="min-h-9 shrink-0 rounded-full border border-[#1a2744] bg-[#1a2744] px-3.5 text-xs font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50 sm:text-sm"
              >
                UPDATE SHEET
              </button>
              {INBOX_QUICK_ACTIONS.map(action => (
                <button
                  key={action.key}
                  onClick={() => handleQuickAction(action.key)}
                  disabled={quickActionSaving !== null}
                  className={`min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition disabled:opacity-50 sm:text-sm ${quickActionClass(action.tone, quickActionSaving === action.key)}`}
                >
                  {quickActionSaving === action.key ? 'Saving...' : action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Thread */}
          <div ref={threadRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5">
            {touchLoading && <div className="text-center text-xs text-slate-400 py-8">Loading…</div>}
            {!touchLoading && touches.length === 0 && <div className="text-center text-xs text-slate-400 py-8">No history yet.</div>}
            {[...touches].reverse().map(touch => {
              const s = summarizeTouch(touch.channel, touch.direction, touch.notes)
              const touchMedia = getTouchMediaUrls(touch)
              const bubbleText = (s.body || '').replace(/\n?\[MMS:\s*[^\]]+\]/ig, '').trim()
              return (
                <div key={touch.id} className={`flex gap-3 ${touch.direction === 'outbound' ? 'flex-row-reverse' : ''}`}>
                  <div className={`hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm sm:flex ${touch.direction === 'outbound' ? 'bg-[#1a2744]' : 'bg-white border border-slate-200'}`}>
                    <ChannelIcon channel={touch.channel} direction={touch.direction} />
                  </div>
                  <div className={`max-w-[88%] rounded-[18px] px-4 py-2.5 text-[15px] sm:max-w-[72%] sm:text-sm ${touch.direction === 'outbound' ? 'rounded-br-[4px] bg-[#1a2744] text-white' : 'rounded-bl-[4px] bg-white text-[#1a2744]'}`}>
                    <div className={`mb-1 flex items-center gap-2 text-[10px] font-semibold ${touch.direction === 'outbound' ? 'text-white/70' : 'text-slate-400'}`}>
                      {s.label}
                      {s.auto && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${touch.direction === 'outbound' ? 'bg-white/15 text-white/90' : 'bg-slate-100 text-slate-500'}`}>Auto</span>}
                    </div>
                    {bubbleText && <div className="whitespace-pre-wrap break-words leading-relaxed">{bubbleText}</div>}
                    {touchMedia.length > 0 && (
                      <div className="mt-2 grid gap-2">
                        {touchMedia.map(url => (
                          isVideoUrl(url) ? (
                            <video key={url} src={url} controls className="max-h-64 rounded-[12px] bg-black" />
                          ) : (
                            <a key={url} href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="" className="max-h-64 rounded-[12px] object-cover" />
                            </a>
                          )
                        ))}
                      </div>
                    )}
                    <div className={`mt-1 text-[10px] ${touch.direction === 'outbound' ? 'text-white/50' : 'text-slate-400'}`}>{fmtDate(touch.created_at)} {fmtTime(touch.created_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Compose */}
          <div className="border-t border-slate-200 bg-white px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
            <div className="mb-2 hidden grid-cols-2 gap-2 md:grid">
              <button onClick={() => setComposeChannel('sms')} className={`min-h-9 rounded-xl px-3 py-2 text-xs font-semibold transition ${composeChannel === 'sms' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                SMS {!selected.phone && <span className="ml-1 text-red-400">no #</span>}
              </button>
              <button onClick={() => setComposeChannel('email')} className={`min-h-9 rounded-xl px-3 py-2 text-xs font-semibold transition ${composeChannel === 'email' ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                Email {!selected.email && <span className="ml-1 text-red-400">no email</span>}
              </button>
            </div>
            {mediaUrls.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {mediaUrls.map(url => (
                  <div key={url} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[12px] border border-slate-200 bg-slate-50">
                    {isVideoUrl(url) ? <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-500">Video</div> : <img src={url} alt="" className="h-full w-full object-cover" />}
                    <button onClick={() => setMediaUrls(current => current.filter(item => item !== url))} className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white">x</button>
                  </div>
                ))}
              </div>
            )}
            {composeChannel === 'sms' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setScheduleMode(current => !current)}
                    className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${scheduleMode ? 'border-[#1a2744] bg-[#1a2744] text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {scheduleMode ? 'Scheduled' : 'Schedule'}
                  </button>
                  {scheduleMode && (
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-[#1a2744] outline-none focus:border-[#1a2744]"
                    />
                  )}
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={addMediaUrl} className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-500 sm:h-11 sm:w-11">+</button>
                  <textarea value={smsBody} onChange={e => setSmsBody(e.target.value)} rows={2} placeholder={selected.phone ? 'Type SMS…' : 'No phone'} disabled={!selected.phone}
                    className="max-h-24 flex-1 resize-none rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-base text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40 sm:max-h-28 sm:text-sm" />
                  <button onClick={handleSend} disabled={sending || !selected.phone || (!smsBody.trim() && mediaUrls.length === 0) || (scheduleMode && !scheduledAt)}
                    className="mb-0.5 h-10 rounded-full bg-[#1a2744] px-4 text-sm font-semibold text-white disabled:opacity-40 sm:h-11">{sending ? '…' : scheduleMode ? 'Schedule' : 'Send'}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                  className="h-10 w-full rounded-[12px] border border-slate-200 bg-slate-50 px-3 text-base text-[#1a2744] outline-none focus:border-[#1a2744] sm:text-sm" />
                <div className="flex gap-2">
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3} placeholder={selected.email ? 'Type email…' : 'No email'} disabled={!selected.email}
                    className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-[#1a2744] outline-none focus:border-[#1a2744] disabled:opacity-40 sm:text-sm" />
                  <button onClick={handleSend} disabled={sending || !selected.email || !emailBody.trim()}
                    className="self-end rounded-[14px] bg-[#1a2744] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{sending ? '…' : 'Send'}</button>
                </div>
              </div>
            )}
          </div>
        </div>
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
              {c.affiliate_partner_id && (
                <div className="mt-2 flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                  <span className="text-[10px] font-semibold text-emerald-700">🔗 Has affiliate portal</span>
                </div>
              )}
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

// ─── Bulk SMS Modal ───────────────────────────────────────────────────────────

function BulkSmsModal({ contacts, onClose }: { contacts: Contact[]; onClose: () => void }) {
  const [template, setTemplate] = useState([
    'Hey {{firstName}}, my name is John. I own Saturn Star Movers, a local moving company serving {{city}}.',
    '',
    'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
    '',
    'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
    '',
    'Would it be okay if I stopped by your office next week to drop off a few cards?',
  ].join('\n'))
  const [fromNumber, setFromNumber] = useState('+12268870667')
  const [preview, setPreview] = useState<Array<{ name: string; phone: string; message: string }> | null>(null)
  const [invalidPhoneSamples, setInvalidPhoneSamples] = useState<Array<{ name: string; phone: string; issue: string }>>([])
  const [skippedPriorSmsSamples, setSkippedPriorSmsSamples] = useState<Array<{ name: string; phone: string; last_touch_at: string | null }>>([])
  const [previewStats, setPreviewStats] = useState<{ will_send: number; skipped_prior_sms: number; no_phone: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; no_phone: number; skipped_prior_sms?: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(contacts.map(c => c.id)))

  const withPhone = contacts.filter(c => c.phone)
  const selected = contacts.filter(c => selectedIds.has(c.id))

  async function loadPreview() {
    setLoading(true)
    const res = await fetch('/api/marketing/contacts/bulk-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: Array.from(selectedIds), template, from_number: fromNumber, preview_only: true }),
    })
    const data = await res.json() as {
      preview?: Array<{ name: string; phone: string; message: string }>
      will_send?: number
      no_phone?: number
      skipped_prior_sms?: number
      skipped_prior_sms_samples?: Array<{ name: string; phone: string; last_touch_at: string | null }>
      invalid_phone_samples?: Array<{ name: string; phone: string; issue: string }>
    }
    setPreview(data.preview || [])
    setInvalidPhoneSamples(data.invalid_phone_samples || [])
    setSkippedPriorSmsSamples(data.skipped_prior_sms_samples || [])
    setPreviewStats({
      will_send: data.will_send ?? 0,
      skipped_prior_sms: data.skipped_prior_sms ?? 0,
      no_phone: data.no_phone ?? 0,
    })
    setLoading(false)
  }

  async function send() {
    const sendCount = previewStats?.will_send ?? selected.filter(c => c.phone).length
    if (!confirm(`Send SMS to ${sendCount} contacts? Already-texted contacts will be skipped.`)) return
    setSending(true)
    const res = await fetch('/api/marketing/contacts/bulk-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ contact_ids: Array.from(selectedIds), template, from_number: fromNumber }),
    })
    const data = await res.json() as { sent: number; failed: number; no_phone: number }
    setResult(data)
    setSending(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-[16px] bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">Bulk SMS</div>
            <div className="text-[11px] text-[var(--app-muted)] mt-0.5">{selected.filter(c => c.phone).length} contacts with phone · from {fromNumber}</div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">✕</button>
        </div>

        {result ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-4xl">✅</div>
            <div className="text-lg font-semibold text-[var(--app-ink)]">{result.sent} messages sent</div>
            <div className="text-sm text-[var(--app-muted)]">
              {result.failed > 0 && `${result.failed} failed · `}
              {result.skipped_prior_sms ? `${result.skipped_prior_sms} already texted skipped · ` : ''}
              {result.no_phone > 0 && `${result.no_phone} had no phone`}
            </div>
            <div className="max-w-sm text-xs leading-5 text-[var(--app-muted)]">
              This send is logged. Do not run this same recipient list again; use a new filtered batch or contacts with no prior outbound SMS.
            </div>
            <button onClick={onClose} className="crm-button-dark px-6">Done</button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Template */}
            <div>
              <label className="crm-label">Message template</label>
              <textarea value={template} onChange={e => { setTemplate(e.target.value); setPreview(null); setPreviewStats(null); setInvalidPhoneSamples([]); setSkippedPriorSmsSamples([]) }} rows={9}
                className="crm-input mt-1 resize-none text-sm" />
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                Preview first. Contacts already texted from this system are skipped automatically so this cannot casually resend the same outreach.
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {['{{firstName}}', '{{name}}', '{{company}}', '{{brokerage}}', '{{city}}', '{{zone}}', '{{industry}}'].map(tag => (
                  <button key={tag} onClick={() => setTemplate(t => t + tag)}
                    className="rounded-full border border-[var(--app-line)] px-2 py-0.5 text-[10px] font-mono text-[var(--app-muted)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]">
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* From number */}
            <div>
              <label className="crm-label">Send from</label>
              <select value={fromNumber} onChange={e => setFromNumber(e.target.value)} className="crm-input mt-1 text-sm">
                <option value="+12268870667">+1 (226) 887-0667 — Windsor Partnership</option>
              </select>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">Sales and operations numbers are intentionally hidden here.</div>
            </div>

            {/* Preview */}
            {preview && (
              <div>
                <div className="crm-label mb-2">Preview</div>
                {previewStats && (
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-2">
                      <div className="text-lg font-semibold text-emerald-800">{previewStats.will_send}</div>
                      <div className="text-[10px] font-semibold uppercase text-emerald-700">Will send</div>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-2">
                      <div className="text-lg font-semibold text-slate-700">{previewStats.skipped_prior_sms}</div>
                      <div className="text-[10px] font-semibold uppercase text-slate-500">Already texted</div>
                    </div>
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-2">
                      <div className="text-lg font-semibold text-amber-800">{previewStats.no_phone}</div>
                      <div className="text-[10px] font-semibold uppercase text-amber-700">No phone</div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {preview.map((p, i) => (
                    <div key={i} className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                      <div className="text-[10px] font-semibold text-[var(--app-muted)]">{p.name} · {p.phone}</div>
                      <div className="mt-1 text-sm text-[var(--app-ink)] whitespace-pre-wrap">{p.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skippedPriorSmsSamples.length > 0 && (
              <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Skipped because they already have an outbound SMS</div>
                <div className="mt-2 space-y-1">
                  {skippedPriorSmsSamples.map((sample, index) => (
                    <div key={`${sample.phone}-${index}`} className="text-[11px] text-slate-600">
                      {sample.name}: {sample.phone}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {invalidPhoneSamples.length > 0 && (
              <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3">
                <div className="text-xs font-semibold text-amber-800">Skipped invalid numbers before sending</div>
                <div className="mt-2 space-y-1">
                  {invalidPhoneSamples.map((sample, index) => (
                    <div key={`${sample.phone}-${index}`} className="text-[11px] text-amber-700">
                      {sample.name}: {sample.phone} — {sample.issue}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Segment selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="crm-label">Recipients ({selected.filter(c => c.phone).length} with phone)</label>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedIds(new Set(withPhone.map(c => c.id)))} className="text-[10px] text-[var(--app-accent)] hover:underline">All with phone</button>
                  <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-[var(--app-muted)] hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto rounded-[8px] border border-[var(--app-line)] divide-y divide-[var(--app-line)]">
                {withPhone.slice(0, 20).map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--app-bg)]">
                    <input type="checkbox" checked={selectedIds.has(c.id)}
                      onChange={e => { const next = new Set(selectedIds); e.target.checked ? next.add(c.id) : next.delete(c.id); setSelectedIds(next) }}
                      className="rounded" />
                    <span className="text-sm text-[var(--app-ink)] truncate">{c.name}</span>
                    <span className="text-[10px] text-[var(--app-muted)] ml-auto">{c.company || c.city || ''}</span>
                  </label>
                ))}
                {withPhone.length > 20 && <div className="px-3 py-1.5 text-[10px] text-[var(--app-muted)]">+ {withPhone.length - 20} more</div>}
              </div>
            </div>
          </div>
        )}

        {!result && (
          <div className="border-t border-[var(--app-line)] p-4 flex gap-2">
            <button onClick={onClose} className="crm-button flex-1">Cancel</button>
            {!preview ? (
              <button onClick={loadPreview} disabled={loading || !template.trim() || selectedIds.size === 0} className="crm-button-dark flex-1 disabled:opacity-50">
                {loading ? 'Previewing…' : 'Preview Merged Texts'}
              </button>
            ) : (
              <button onClick={send} disabled={sending} className="crm-button-dark flex-1 disabled:opacity-50">
                {sending ? 'Sending…' : `Approve & Send to ${previewStats?.will_send ?? selected.filter(c => c.phone).length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Scheduled Partnership SMS Modal ─────────────────────────────────────────

const PARTNERSHIP_SMS_TEMPLATE = [
  'Hey {{firstName}}, my name is John. I run a local moving company serving the {{city}} area....It\'s called SSM | Saturn Star Movers.',
  '',
  'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
  '',
  'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
  '',
  'Would it be okay if I stopped by your office next week to drop off a few cards?',
].join('\n')

function mapCsvRealtor(row: Record<string, string>) {
  return {
    name: row.name || '',
    company: row.brokerage || row.company || '',
    title: row.position || row.title || 'Realtor',
    email: row.email || '',
    phone: row.phone || '',
    phone2: row.phone2 || '',
    phone3: row.phone3 || '',
    address: row.brokerage_address || row.address || '',
    city: row.city_scraped || row.city || row.zone || '',
    zone: row.zone || row.city_scraped || row.city || '',
    industry: 'real estate',
    website: row.website || '',
    category: 'realtor',
    external_id: row.individual_id || '',
    profile_url: row.profile_url || '',
    photo_url: row.photo_url || '',
    notes: [
      row.facebook ? `Facebook: ${row.facebook}` : '',
      row.instagram ? `Instagram: ${row.instagram}` : '',
      row.linkedin ? `LinkedIn: ${row.linkedin}` : '',
    ].filter(Boolean).join('\n'),
  }
}

function labelFromZone(zone: string) {
  return zone
    .replace(/^zone\d+_/, '')
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function ScheduledSmsCampaignModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [segmentMode, setSegmentMode] = useState<'zone' | 'city'>('zone')
  const [segment, setSegment] = useState('zone1_windsor_essex')
  const [name, setName] = useState('Windsor Essex Realtor Partnership SMS')
  const [template, setTemplate] = useState(PARTNERSHIP_SMS_TEMPLATE)
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [dailyCap, setDailyCap] = useState(400)
  const [startHour, setStartHour] = useState(10)
  const [endHour, setEndHour] = useState(13)
  const [preview, setPreview] = useState<PartnershipSmsPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [result, setResult] = useState<{ campaign_id?: string; scheduled?: number; days_to_finish?: number } | null>(null)
  const [error, setError] = useState('')

  const availableZones = Array.from(new Set(rows.map(row => row.zone).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const availableCities = Array.from(new Set(rows.map(row => row.city_scraped || row.city).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const selectedRows = rows.filter(row => {
    if (!segment) return true
    const value = segmentMode === 'zone' ? row.zone : (row.city_scraped || row.city)
    return (value || '').toLowerCase() === segment.toLowerCase()
  })
  const contacts = selectedRows.map(mapCsvRealtor)
  const selectedCities = Array.from(new Set(selectedRows.map(row => row.city_scraped || row.city).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const segmentLabel = segmentMode === 'zone' ? labelFromZone(segment) : segment

  async function handleFile(file: File | null) {
    if (!file) return
    const text = await file.text()
    const parsed = parseCSV(text)
    setRows(parsed)
    setFileName(file.name)
    const firstZone = parsed.find(row => row.zone)?.zone
    const nextSegment = firstZone || parsed.find(row => row.city_scraped || row.city)?.city_scraped || parsed.find(row => row.city)?.city || segment
    const nextMode = firstZone ? 'zone' : 'city'
    setSegmentMode(nextMode)
    setSegment(nextSegment)
    setName(`${nextMode === 'zone' ? labelFromZone(nextSegment) : nextSegment} Realtor Partnership SMS`)
    setPreview(null)
    setResult(null)
    setError('')
  }

  async function submit(dryRun: boolean) {
    if (!contacts.length) {
      setError('Upload a CSV and choose a city first.')
      return
    }
    setError('')
    dryRun ? setLoading(true) : setScheduling(true)
    const res = await fetch('/api/marketing/sms/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name,
        city: segmentMode === 'city' ? segment : undefined,
        zone: segmentMode === 'zone' ? segment : undefined,
        contacts,
        template,
        sender_numbers: ['+12268870667', '+12266055008'],
        daily_cap: dailyCap,
        start_date: startDate,
        start_hour: startHour,
        end_hour: endHour,
        timezone: 'America/Toronto',
        dry_run: dryRun,
      }),
    })
    const data = await res.json().catch(() => ({})) as PartnershipSmsPreview & { campaign_id?: string; scheduled?: number; days_to_finish?: number }
    if (!res.ok) {
      setError(data.error || 'Campaign request failed.')
    } else if (dryRun) {
      setPreview(data)
    } else {
      setResult({ campaign_id: data.campaign_id, scheduled: data.scheduled, days_to_finish: data.days_to_finish })
      onDone()
    }
    setLoading(false)
    setScheduling(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col rounded-t-[18px] bg-white shadow-2xl sm:rounded-[18px]">
        <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3 sm:px-5">
          <div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">Schedule partnership SMS</div>
            <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Preview first. Nothing sends until you approve scheduling.</div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">x</button>
        </div>

        {result ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="text-3xl">Scheduled</div>
            <div className="text-base font-semibold text-[var(--app-ink)]">{result.scheduled ?? 0} SMS jobs created</div>
            <div className="text-sm text-[var(--app-muted)]">Estimated {result.days_to_finish ?? 0} business day{result.days_to_finish === 1 ? '' : 's'} at {dailyCap}/day.</div>
            <button onClick={onClose} className="crm-button-dark px-6">Done</button>
          </div>
        ) : (
          <>
            <div className="grid flex-1 gap-0 overflow-y-auto md:grid-cols-[360px_1fr]">
              <div className="space-y-4 border-b border-[var(--app-line)] p-4 md:border-b-0 md:border-r sm:p-5">
                <div>
                  <label className="crm-label">CSV file</label>
                  <input type="file" accept=".csv,text/csv" onChange={e => { void handleFile(e.target.files?.[0] || null) }}
                    className="mt-1 block w-full text-sm text-[var(--app-muted)] file:mr-3 file:rounded-[10px] file:border-0 file:bg-[var(--app-ink)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white" />
                  <div className="mt-1 text-[11px] text-[var(--app-muted)]">{fileName || 'Upload the realtor CSV.'}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="crm-label">Group by</label>
                    <select value={segmentMode} onChange={e => {
                      const nextMode = e.target.value as 'zone' | 'city'
                      const nextSegment = nextMode === 'zone' ? (availableZones[0] || segment) : (availableCities[0] || segment)
                      setSegmentMode(nextMode)
                      setSegment(nextSegment)
                      setName(`${nextMode === 'zone' ? labelFromZone(nextSegment) : nextSegment} Realtor Partnership SMS`)
                      setPreview(null)
                    }} className="crm-input mt-1 text-sm">
                      <option value="zone">Area / zone</option>
                      <option value="city">Exact city</option>
                    </select>
                  </div>
                  <div>
                    <label className="crm-label">{segmentMode === 'zone' ? 'Area' : 'City'}</label>
                    <select value={segment} onChange={e => {
                      const next = e.target.value
                      setSegment(next)
                      setName(`${segmentMode === 'zone' ? labelFromZone(next) : next} Realtor Partnership SMS`)
                      setPreview(null)
                    }} className="crm-input mt-1 text-sm">
                      {segmentMode === 'zone' ? (
                        <>
                          {availableZones.length === 0 && <option value={segment}>{labelFromZone(segment)}</option>}
                          {availableZones.map(z => <option key={z} value={z}>{labelFromZone(z)} ({z})</option>)}
                        </>
                      ) : (
                        <>
                          {availableCities.length === 0 && <option value={segment}>{segment}</option>}
                          {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="crm-label">Daily cap</label>
                  <input type="number" min={1} max={500} value={dailyCap} onChange={e => { setDailyCap(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                </div>

                <div>
                  <label className="crm-label">Campaign name</label>
                  <input value={name} onChange={e => setName(e.target.value)} className="crm-input mt-1 text-sm" />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="crm-label">Start date</label>
                    <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="crm-label">From</label>
                    <input type="number" min={7} max={20} value={startHour} onChange={e => { setStartHour(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="crm-label">To</label>
                    <input type="number" min={8} max={21} value={endHour} onChange={e => { setEndHour(Number(e.target.value)); setPreview(null) }} className="crm-input mt-1 text-sm" />
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 text-xs leading-5 text-[var(--app-muted)]">
                  Uses both partnership numbers, primary phone only, exact-name/phone duplicate checks, and Toronto/Windsor working hours.
                </div>

                {selectedCities.length > 0 && (
                  <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-3">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">{segmentLabel || 'Selected segment'} includes {selectedCities.length} cit{selectedCities.length === 1 ? 'y' : 'ies'}</div>
                    <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {selectedCities.slice(0, 24).map(c => (
                        <span key={c} className="rounded-full border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--app-muted)]">{c}</span>
                      ))}
                      {selectedCities.length > 24 && <span className="px-1 py-0.5 text-[10px] text-[var(--app-muted)]">+{selectedCities.length - 24}</span>}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div>
                  <label className="crm-label">Message</label>
                  <textarea value={template} onChange={e => { setTemplate(e.target.value); setPreview(null) }} rows={9}
                    className="crm-input mt-1 resize-none text-sm leading-5" />
                  <div className="mt-1 text-[11px] text-[var(--app-muted)]">City comes from each CSV row, even when scheduling a whole area. Tecumseh rows say Tecumseh; Windsor rows say Windsor.</div>
                </div>

                {error && <div className="rounded-[10px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

                {preview && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 p-3 text-center">
                        <div className="text-xl font-semibold text-emerald-800">{preview.would_schedule}</div>
                        <div className="text-[10px] font-bold uppercase text-emerald-700">Will schedule</div>
                      </div>
                      <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3 text-center">
                        <div className="text-xl font-semibold text-slate-800">{preview.existing_skipped_no_repeat}</div>
                        <div className="text-[10px] font-bold uppercase text-slate-500">Existing skipped</div>
                      </div>
                      <div className="rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-center">
                        <div className="text-xl font-semibold text-amber-800">{preview.no_primary_phone + preview.invalid_phone}</div>
                        <div className="text-[10px] font-bold uppercase text-amber-700">No usable primary</div>
                      </div>
                      <div className="rounded-[10px] border border-sky-200 bg-sky-50 p-3 text-center">
                        <div className="text-xl font-semibold text-sky-800">{preview.days_to_finish}</div>
                        <div className="text-[10px] font-bold uppercase text-sky-700">Business days</div>
                      </div>
                    </div>

                    <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-3">
                      <div className="text-xs font-semibold text-[var(--app-ink)]">Dry-run details</div>
                      <div className="mt-2 grid gap-1 text-xs text-[var(--app-muted)] sm:grid-cols-2">
                        <div>Total selected rows: {preview.total_input}</div>
                        <div>Primary phones: {preview.usable_with_phone}</div>
                        <div>Phone matches: {preview.existing_phone_matches}</div>
                        <div>Exact name matches: {preview.existing_exact_name_matches}</div>
                        <div>Duplicate primary phones in file: {preview.duplicate_in_file}</div>
                        <div>Window: {preview.start_hour}:00-{preview.end_hour}:00 {preview.timezone}</div>
                      </div>
                    </div>

                    <div>
                      <div className="crm-label mb-2">Sample scheduled messages</div>
                      <div className="space-y-2">
                        {(preview.preview || []).map((item, index) => (
                          <div key={`${item.phone}-${index}`} className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                            <div className="flex flex-wrap justify-between gap-2 text-[11px] font-semibold text-[var(--app-muted)]">
                              <span>{item.name} · {item.city || segmentLabel} · {item.phone}</span>
                              <span>{item.from_number} · {fmtDateTime(item.scheduled_at)}</span>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-5 text-[var(--app-ink)]">{item.message}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 border-t border-[var(--app-line)] p-4">
              <button onClick={onClose} className="crm-button flex-1">Cancel</button>
              <button onClick={() => void submit(true)} disabled={loading || contacts.length === 0 || !template.trim()} className="crm-button flex-1 disabled:opacity-50">
                {loading ? 'Previewing...' : `Preview ${contacts.length || ''}`}
              </button>
              <button onClick={() => { if (preview && confirm(`Schedule ${preview.would_schedule} SMS jobs?`)) void submit(false) }} disabled={scheduling || !preview || preview.would_schedule === 0}
                className="crm-button-dark flex-1 disabled:opacity-50">
                {scheduling ? 'Scheduling...' : 'Approve schedule'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Queue Tab — mirrors sales Follow-Up Wall ─────────────────────────────────

function urgencyBar(contact: Contact): string {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : 999
  if (contact.sequence_paused && !contact.decision) return 'bg-[var(--app-accent)]'   // responded — act now
  if (daysSince >= 7) return 'bg-[#c9754e]'                                             // overdue
  if (daysSince >= 3) return 'bg-[#d0a24d]'                                             // due soon
  return 'bg-[var(--app-line)]'                                                          // fresh
}

function urgencyCardBorder(contact: Contact): string {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : 999
  if (contact.sequence_paused && !contact.decision) return 'border-[rgba(15,106,83,0.25)] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbf9_100%)]'
  if (daysSince >= 7) return 'border-[#e6d1ca] bg-[linear-gradient(180deg,#ffffff_0%,#fff8f6_100%)]'
  if (daysSince >= 3) return 'border-[#eadfcb] bg-[linear-gradient(180deg,#ffffff_0%,#fffcf6_100%)]'
  return 'border-[var(--app-line)] bg-white'
}

function QueueContactCard({ contact, onSelect, onCall, batchLabel }: {
  contact: Contact
  onSelect: (c: Contact) => void
  onCall: (c: Contact) => void
  batchLabel?: string
}) {
  const daysSince = contact.last_touch_at
    ? Math.floor((Date.now() - new Date(contact.last_touch_at).getTime()) / 86400000)
    : null

  return (
    <div className={`rounded-[14px] border p-4 shadow-sm transition hover:shadow-md ${urgencyCardBorder(contact)}`}>
      <div className={`mb-3 h-1 rounded-full ${urgencyBar(contact)}`} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => onSelect(contact)} className="text-sm font-semibold text-[var(--app-ink)] hover:text-[var(--app-accent)] transition truncate max-w-[160px]">
              {contact.name}
            </button>
            {batchLabel && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                {batchLabel}
              </span>
            )}
            {contact.category && <CategoryBadge categoryId={contact.category} />}
            {!contact.category && contact.outreach_tier && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${contact.outreach_tier === 1 ? 'border border-amber-200 bg-amber-50 text-amber-700' : contact.outreach_tier === 2 ? 'border border-sky-200 bg-sky-50 text-sky-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
                T{contact.outreach_tier}
              </span>
            )}
            {contact.instantly_status && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${contact.instantly_status === 'replied' ? 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : contact.instantly_status === 'opened' ? 'border border-sky-200 bg-sky-50 text-sky-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
                ✉ {contact.instantly_status}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-[var(--app-muted)]">
            {contact.company && <span>{contact.company}</span>}
            {contact.city && <span>· {contact.city}</span>}
            {contact.industry && <span>· {contact.industry}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {daysSince !== null && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${daysSince === 0 ? 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : daysSince <= 3 ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[var(--app-muted)]'}`}>
              {daysSince === 0 ? 'Today' : `${daysSince}d ago`}
            </span>
          )}
        </div>
      </div>

      {contact.latest_touch_note && (
        <div className="mt-2 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-[11px] text-[var(--app-muted)] line-clamp-2">
          {contact.latest_touch_note.slice(0, 120)}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {contact.phone && (
          <button onClick={() => onCall(contact)}
            className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            📞 Call
          </button>
        )}
        {contact.phone && (
          <button onClick={() => window.open(`sms:${contact.phone}`)}
            className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            💬 SMS
          </button>
        )}
        <button onClick={() => onSelect(contact)}
          className={`${contact.phone ? '' : 'col-span-2'} flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition`}>
          Open
        </button>
        <button onClick={() => onSelect(contact)}
          className="flex-1 rounded-[8px] bg-[var(--app-accent)] py-1.5 text-xs font-semibold text-white hover:opacity-90 transition">
          Log
        </button>
      </div>
    </div>
  )
}

function QueueTab({ contacts, batches, onSelect, onScheduleCampaign }: {
  contacts: Contact[]
  batches: Batch[]
  onSelect: (c: Contact) => void
  onScheduleCampaign: () => void
}) {
  const dialer = useDialer()
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterBatch, setFilterBatch] = useState('')

  function handleCall(c: Contact) {
    if (!c.phone) return
    void dialer.call(c.phone)
  }

  const batchMeta = useMemo(() => {
    const sortedBatches = [...batches].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return new Map(sortedBatches.map((batch, index) => [
      batch.id,
      {
        label: `Batch ${index + 1}`,
        name: batch.name,
        contacts: batch.total_contacts || contacts.filter(contact => contact.batch_id === batch.id).length,
      },
    ]))
  }, [batches, contacts])

  const batchOptions = useMemo(() => Array.from(batchMeta.entries()).map(([id, meta]) => ({ id, ...meta })), [batchMeta])

  const filtered = contacts.filter(c => {
    if (search && !`${c.name} ${c.company} ${c.city} ${c.industry} ${c.category}`.toLowerCase().includes(search.toLowerCase())) return false
    if (filterCategory && c.category !== filterCategory) return false
    if (filterCity && (c.city || '').toLowerCase() !== filterCity.toLowerCase()) return false
    if (filterBatch && c.batch_id !== filterBatch) return false
    return true
  })

  // Available categories and cities in the current contact list
  const availableCategories = Array.from(new Set(contacts.map(c => c.category).filter(Boolean))) as string[]
  const availableCities = Array.from(new Set(contacts.map(c => c.city).filter(Boolean))) as string[]

  // Three buckets
  const responded = filtered.filter(c => c.sequence_paused && !c.decision)
  const overdue = filtered.filter(c => !c.sequence_paused && c.last_touch_at &&
    Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) >= 5)
  const callFirst = filtered.filter(c => !c.sequence_paused && c.phone &&
    (!c.last_touch_at || Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) < 5) &&
    (c.normalized_stage === 'target' || c.normalized_stage === 'mail_sent' || c.normalized_stage === 'attempting_contact'))
    .sort((a, b) => (b.outreach_tier ?? 3) < (a.outreach_tier ?? 3) ? 1 : -1)

  const urgentCount = responded.length + overdue.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-[var(--app-ink)]">Outbound Queue</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${urgentCount > 0 ? 'border border-[rgba(201,117,78,0.12)] bg-[#f6ece7] text-[#955941]' : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'}`}>
              <span className={`h-2 w-2 rounded-full ${urgentCount > 0 ? 'bg-[#c9754e]' : 'bg-[var(--app-accent)]'}`} />
              {urgentCount > 0 ? `${urgentCount} need attention` : 'Queue clear'}
            </span>
            {filtered.length !== contacts.length && (
              <span className="text-xs text-[var(--app-muted)]">Showing {filtered.length} of {contacts.length}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onScheduleCampaign} className="crm-button-dark text-sm">Schedule campaign</button>
          <select value={filterBatch} onChange={e => setFilterBatch(e.target.value)} className="crm-input w-52 text-sm">
            <option value="">All batches</option>
            {batchOptions.map(batch => (
              <option key={batch.id} value={batch.id}>{batch.label} · {batch.name}</option>
            ))}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="crm-input w-36 text-sm" />
        </div>
      </div>

      {/* Category + city filters */}
      <div className="flex flex-wrap gap-2">
        {batchOptions.length > 0 && (
          <>
            <button onClick={() => setFilterBatch('')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!filterBatch ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              All batches
            </button>
            {batchOptions.map(batch => (
              <button key={batch.id} onClick={() => setFilterBatch(filterBatch === batch.id ? '' : batch.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filterBatch === batch.id ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
                {batch.label} <span className="font-medium opacity-70">{batch.contacts}</span>
              </button>
            ))}
          </>
        )}
        <button onClick={() => { setFilterCategory(''); setFilterCity('') }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${!filterCategory && !filterCity ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
          All
        </button>
        {SERVICE_AREAS.filter(a => availableCities.some(c => c.toLowerCase() === a.id)).map(a => (
          <button key={a.id} onClick={() => setFilterCity(filterCity === a.id ? '' : a.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${filterCity === a.id ? 'bg-[var(--app-ink)] text-white' : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
            📍 {a.label}
          </button>
        ))}
        {availableCategories.map(catId => {
          const meta = getCategoryMeta(catId)
          if (!meta) return null
          return (
            <button key={catId} onClick={() => setFilterCategory(filterCategory === catId ? '' : catId)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filterCategory === catId ? `${meta.color} ring-1 ring-current` : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>

      {/* Responded — act now */}
      {responded.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--app-accent)]" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Responded — Act Now</span>
            <span className="rounded-full border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--app-accent)]">{responded.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {responded.map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {/* Overdue — gone silent */}
      {overdue.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#c9754e]" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Gone Silent 5d+</span>
            <span className="rounded-full border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] px-2 py-0.5 text-[10px] font-bold text-[#955941]">{overdue.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {overdue.slice(0, 10).map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {/* Call first — fresh targets */}
      {callFirst.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            <span className="text-sm font-semibold text-[var(--app-ink)]">Call First — Tier 1 Priority</span>
            <span className="rounded-full border border-[var(--app-line)] bg-[var(--app-wash)] px-2 py-0.5 text-[10px] font-bold text-[var(--app-muted)]">{callFirst.length}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {callFirst.slice(0, 20).map(c => <QueueContactCard key={c.id} contact={c} batchLabel={c.batch_id ? batchMeta.get(c.batch_id)?.label : undefined} onSelect={onSelect} onCall={handleCall} />)}
          </div>
        </div>
      )}

      {responded.length === 0 && overdue.length === 0 && callFirst.length === 0 && (
        <div className="rounded-[16px] border border-dashed border-[var(--app-line)] bg-white p-16 text-center">
          <div className="text-3xl">✅</div>
          <div className="mt-4 text-sm font-semibold text-[var(--app-ink)]">Queue is clear</div>
          <div className="mt-1 text-xs text-[var(--app-muted)]">Import a batch to start working contacts</div>
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'queue' | 'replies' | 'overview' | 'lists' | 'pipeline' | 'phone' | 'partners'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'queue',    label: 'Queue',    icon: '⚡' },
  { key: 'phone',    label: 'Inbox',    icon: '💬' },
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'lists',    label: 'Lists',    icon: '📋' },
  { key: 'pipeline', label: 'Pipeline', icon: '🎯' },
  { key: 'partners', label: 'Partners', icon: '🤝' },
]

function PartnershipEngineInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTab = (searchParams.get('tab') as Tab) || 'phone'
  const [tab, setTab] = useState<Tab>(initialTab === 'replies' ? 'phone' : initialTab)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  const loadContacts = useCallback(async () => {
    setContactsLoading(true)
    const r = await fetch('/api/marketing/contacts?limit=2000&offset=0', { credentials: 'include' })
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

  function handleOpenThread(contact: Contact) {
    setTab('phone')
    router.replace(`/marketing/partners?tab=phone&contact=${contact.id}`, { scroll: false })
  }

  function handleContactUpdated(contact: Contact) {
    const normalized = {
      ...contact,
      normalized_stage: String(contact.stage || contact.normalized_stage || ''),
    }
    setContacts(curr => {
      const seen = curr.some(c => c.id === normalized.id)
      return seen ? curr.map(c => c.id === normalized.id ? { ...c, ...normalized } : c) : [normalized, ...curr]
    })
    setSelectedContact(curr => curr?.id === normalized.id ? { ...curr, ...normalized } : curr)
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

  const [bulkSmsContacts, setBulkSmsContacts] = useState<Contact[] | null>(null)
  const [scheduledSmsOpen, setScheduledSmsOpen] = useState(false)
  const needsReplyCount = contacts.filter(c => c.sequence_paused && !c.decision).length
  const queueCount = needsReplyCount + contacts.filter(c =>
    c.last_touch_at && Math.floor((Date.now() - new Date(c.last_touch_at).getTime()) / 86400000) >= 5
  ).length
  const inboxActive = tab === 'phone' || tab === 'replies'

  return (
    <div className={inboxActive ? 'min-h-screen bg-white md:bg-[var(--app-bg,#f0f2f5)]' : 'min-h-screen bg-[var(--app-bg,#f0f2f5)]'}>
      <div className={inboxActive ? 'mx-0 max-w-none px-0 py-0 md:mx-auto md:max-w-6xl md:px-6 md:py-8' : 'mx-auto max-w-6xl px-4 py-8 sm:px-6'}>
        <div className={`${inboxActive ? 'hidden md:flex' : 'flex'} mb-6 items-center justify-between`}>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--app-ink)]">Partnership Engine</h1>
            <p className="mt-0.5 text-sm text-[var(--app-muted)]">
              {batchesLoading ? '—' : batches.length} batch{batches.length !== 1 ? 'es' : ''} · {contactsLoading ? '—' : contacts.length} contacts
              {needsReplyCount > 0 && <span className="ml-2 rounded-full bg-[var(--app-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">{needsReplyCount} responded</span>}
            </p>
          </div>
        </div>

        <div className={`${inboxActive ? 'hidden md:flex' : 'flex'} mb-6 gap-1 rounded-[16px] border border-[var(--app-line)] bg-[var(--app-panel,white)] p-1.5`}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-semibold transition ${tab === t.key ? 'bg-[var(--app-ink)] text-white shadow-sm' : 'text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}>
              <span>{t.icon}</span>
              <span className="hidden sm:inline">{t.label}</span>
              {t.key === 'queue' && queueCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]'}`}>{queueCount}</span>
              )}
              {t.key === 'phone' && needsReplyCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${tab === t.key ? 'bg-white/20 text-white' : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'}`}>{needsReplyCount}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'queue' && (
          <QueueTab contacts={contacts} batches={batches} onSelect={setSelectedContact}
            onScheduleCampaign={() => setScheduledSmsOpen(true)} />
        )}
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
        {(tab === 'phone' || tab === 'replies') && (
          <PhoneTab contacts={contacts} lists={lists} onSelectContact={setSelectedContact} onContactUpdated={handleContactUpdated} />
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

        {bulkSmsContacts && (
          <BulkSmsModal contacts={bulkSmsContacts} onClose={() => setBulkSmsContacts(null)} />
        )}
        {scheduledSmsOpen && (
          <ScheduledSmsCampaignModal
            onClose={() => setScheduledSmsOpen(false)}
            onDone={() => { void loadBatches(); void loadContacts() }}
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
