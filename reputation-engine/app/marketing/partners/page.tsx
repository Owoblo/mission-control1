'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  PARTNERSHIP_STAGE_META,
  PARTNERSHIP_STAGE_ORDER,
  defaultFollowUpDate,
  getPipelineBucket,
  normalizePartnershipStage,
  toDateInput,
} from '@/lib/marketing'

interface MarketContact {
  id: string
  name: string
  company: string
  title: string
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  city: string | null
  industry: string | null
  tier: string | null
  tracking_code: string | null
  stage: string | null
  normalized_stage: string
  notes: string | null
  last_touch_at: string | null
  next_follow_up: string | null
  owner_name?: string | null
  owner_email?: string | null
  priority?: string | null
  account_status?: string | null
  mailed_at?: string | null
  mailed_by?: string | null
  meeting_booked_at?: string | null
  partnership_outcome?: string | null
  partnership_outcome_at?: string | null
  partnership_started_at?: string | null
  last_inbound_at?: string | null
  referred_lead_count?: number | null
  created_at: string
  pipeline: 'partners' | 'corporate'
  touch_count: number
  pending_queue_count: number
  next_queue_due: string | null
  next_queue_label: string | null
  last_direct_mail_at: string | null
  last_call_at: string | null
  last_email_at: string | null
  needs_follow_up: boolean
  has_reply: boolean
}

interface Touch {
  id: string
  channel: string
  direction: string
  notes: string
  created_by: string
  created_at: string
  outcome_code?: string | null
  next_step?: string | null
  next_follow_up_on?: string | null
}

const CHANNELS = [
  { value: 'phone', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'direct_mail', label: 'Direct Mail' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'sms', label: 'SMS' },
  { value: 'in_person', label: 'In Person' },
] as const

const OUTCOME_OPTIONS = [
  { value: '', label: 'General touch' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'voicemail', label: 'Voicemail left' },
  { value: 'gatekeeper', label: 'Gatekeeper spoke' },
  { value: 'replied_positive', label: 'Positive reply' },
  { value: 'meeting_booked', label: 'Meeting booked' },
  { value: 'partnership_secured', label: 'Partnership secured' },
  { value: 'replied_negative', label: 'Declined / not interested' },
  { value: 'not_fit', label: 'Not a fit' },
] as const

function fmtDate(date?: string | null) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function daysUntil(date?: string | null) {
  if (!date) return null
  const today = new Date(toDateInput(new Date())).getTime()
  const target = new Date(toDateInput(date)).getTime()
  return Math.round((target - today) / 86400000)
}

function PartnersInner() {
  const searchParams = useSearchParams()
  const [contacts, setContacts] = useState<MarketContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [pipeline, setPipeline] = useState<'all' | 'partners' | 'corporate'>(searchParams.get('pipeline') === 'corporate' ? 'corporate' : searchParams.get('pipeline') === 'partners' ? 'partners' : 'all')
  const [focus, setFocus] = useState<'all' | 'due'>((searchParams.get('focus') === 'due') ? 'due' : 'all')
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') ?? '')
  const [selected, setSelected] = useState<MarketContact | null>(null)
  const [touches, setTouches] = useState<Touch[]>([])
  const [touchLoading, setTouchLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [editFollowUp, setEditFollowUp] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [priority, setPriority] = useState('normal')
  const [accountStatus, setAccountStatus] = useState('active')
  const [meetingBookedAt, setMeetingBookedAt] = useState('')
  const [partnershipOutcome, setPartnershipOutcome] = useState('')
  const [referredLeadCount, setReferredLeadCount] = useState(0)
  const [logForm, setLogForm] = useState({
    channel: 'phone',
    notes: '',
    new_stage: '',
    schedule_follow_up_days: 7,
    outcome_code: '',
    next_step: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '200', offset: '0' })
    if (query.trim()) params.set('q', query.trim())
    const r = await fetch(`/api/marketing/contacts?${params}`, { credentials: 'include' })
    if (r.ok) {
      const data = await r.json()
      setContacts(data.contacts)
      setTotal(data.total)
      if (!selected && data.contacts[0]) {
        setSelected(data.contacts[0])
        setEditNotes(data.contacts[0].notes ?? '')
        setEditFollowUp(data.contacts[0].next_follow_up ?? '')
        setOwnerName(data.contacts[0].owner_name ?? '')
        setOwnerEmail(data.contacts[0].owner_email ?? '')
        setPriority(data.contacts[0].priority ?? 'normal')
        setAccountStatus(data.contacts[0].account_status ?? 'active')
        setMeetingBookedAt(data.contacts[0].meeting_booked_at ? toDateInput(data.contacts[0].meeting_booked_at) : '')
        setPartnershipOutcome(data.contacts[0].partnership_outcome ?? '')
        setReferredLeadCount(data.contacts[0].referred_lead_count ?? 0)
      }
    }
    setLoading(false)
  }, [query, selected])

  useEffect(() => {
    void load()
  }, [load])

  async function openContact(contact: MarketContact) {
    setSelected(contact)
    setEditNotes(contact.notes ?? '')
    setEditFollowUp(contact.next_follow_up ?? '')
    setOwnerName(contact.owner_name ?? '')
    setOwnerEmail(contact.owner_email ?? '')
    setPriority(contact.priority ?? 'normal')
    setAccountStatus(contact.account_status ?? 'active')
    setMeetingBookedAt(contact.meeting_booked_at ? toDateInput(contact.meeting_booked_at) : '')
    setPartnershipOutcome(contact.partnership_outcome ?? '')
    setReferredLeadCount(contact.referred_lead_count ?? 0)
    setTouchLoading(true)
    const r = await fetch(`/api/marketing/touches?contact_id=${contact.id}`, { credentials: 'include' })
    setTouches(r.ok ? await r.json() : [])
    setTouchLoading(false)
  }

  async function saveProfile() {
    if (!selected) return
    setSaving(true)
    const r = await fetch('/api/marketing/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: selected.id,
        notes: editNotes,
        next_follow_up: editFollowUp || null,
        owner_name: ownerName || null,
        owner_email: ownerEmail || null,
        priority,
        account_status: accountStatus,
        meeting_booked_at: meetingBookedAt || null,
        partnership_outcome: partnershipOutcome || null,
        referred_lead_count: referredLeadCount,
      }),
    })
    if (r.ok) {
      const data = await r.json()
      setSelected(current => current ? { ...current, ...data.contact } : current)
      await load()
    }
    setSaving(false)
  }

  async function quickAction(action: 'mark_mail_sent' | 'mark_follow_up_due' | 'mark_partnership_active' | 'snooze_21_days') {
    if (!selected) return
    setSaving(true)
    const touchNote = action === 'mark_mail_sent'
      ? 'Initial mail package sent'
      : action === 'mark_partnership_active'
        ? 'Partnership secured'
        : action === 'snooze_21_days'
          ? 'Relationship snoozed for next nurture cycle'
          : 'Marked for immediate follow-up'
    const r = await fetch('/api/marketing/contacts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: selected.id,
        quick_action: action,
        next_follow_up: action === 'mark_mail_sent' ? defaultFollowUpDate(new Date(), 21) : undefined,
        touch_note: touchNote,
      }),
    })
    if (r.ok) {
      const data = await r.json()
      setSelected(current => current ? { ...current, ...data.contact } : current)
      await openContact({ ...selected, ...data.contact })
      await load()
    }
    setSaving(false)
  }

  async function logTouch() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/marketing/touches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        contact_id: selected.id,
        channel: logForm.channel,
        notes: logForm.notes,
        new_stage: logForm.new_stage || undefined,
        schedule_follow_up_days: logForm.schedule_follow_up_days,
        outcome_code: logForm.outcome_code || undefined,
        next_step: logForm.next_step || undefined,
      }),
    })
    setLogForm({ channel: 'phone', notes: '', new_stage: '', schedule_follow_up_days: 7, outcome_code: '', next_step: '' })
    await load()
    await openContact(selected)
    setSaving(false)
  }

  const filtered = useMemo(() => {
    return contacts
      .filter(contact => pipeline === 'all' ? true : contact.pipeline === pipeline)
      .filter(contact => focus === 'due' ? contact.needs_follow_up : true)
      .filter(contact => stageFilter ? normalizePartnershipStage(contact.stage) === stageFilter : true)
      .sort((a, b) => {
        if (a.needs_follow_up !== b.needs_follow_up) return a.needs_follow_up ? -1 : 1
        const aDate = a.next_follow_up || a.next_queue_due || a.last_touch_at || a.created_at
        const bDate = b.next_follow_up || b.next_queue_due || b.last_touch_at || b.created_at
        return new Date(aDate).getTime() - new Date(bDate).getTime()
      })
  }, [contacts, focus, pipeline, stageFilter])

  const counts = useMemo(() => {
    return filtered.reduce<Record<string, number>>((acc, contact) => {
      const stage = normalizePartnershipStage(contact.stage)
      acc[stage] = (acc[stage] ?? 0) + 1
      return acc
    }, {})
  }, [filtered])

  const dueNowCount = filtered.filter(contact => contact.needs_follow_up).length
  const mailedCount = filtered.filter(contact => normalizePartnershipStage(contact.stage) === 'mail_sent').length

  return (
    <div className="grid gap-6 xl:grid-cols-[420px,minmax(0,1fr)]">
      <section className="overflow-hidden rounded-[26px] border border-[var(--app-line)] bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-[#1a2744]">Partnerships Workspace</h1>
              <p className="mt-1 text-sm text-slate-500">Mail sent, follow-up due, relationship stage, and daily outreach all in one queue.</p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-right">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Loaded</div>
              <div className="text-lg font-semibold text-[#1a2744]">{total}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <MiniStat label="Due Now" value={dueNowCount} tone="text-rose-600" />
            <MiniStat label="Mailed" value={mailedCount} tone="text-amber-700" />
            <MiniStat label="Active" value={counts.partnership_active ?? 0} tone="text-emerald-700" />
          </div>

          <div className="mt-4 flex gap-2">
            {(['all', 'partners', 'corporate'] as const).map(value => (
              <button
                key={value}
                onClick={() => setPipeline(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${pipeline === value ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {value === 'all' ? 'All' : value === 'partners' ? 'Partner Pipeline' : 'Corporate'}
              </button>
            ))}
            <button
              onClick={() => setFocus(focus === 'due' ? 'all' : 'due')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${focus === 'due' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Due Now Only
            </button>
          </div>

          <div className="mt-4">
            <input
              type="text"
              placeholder="Search name, company, city..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]"
            />
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setStageFilter('')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${!stageFilter ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              All stages
            </button>
            {PARTNERSHIP_STAGE_ORDER.slice(0, 7).map(stage => (
              <button
                key={stage}
                onClick={() => setStageFilter(stageFilter === stage ? '' : stage)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${stageFilter === stage ? 'bg-[#1a2744] text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {PARTNERSHIP_STAGE_META[stage].shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[calc(100vh-270px)] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">Loading partnership accounts...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No accounts match the current filters.</div>
          ) : filtered.map(contact => {
            const meta = PARTNERSHIP_STAGE_META[normalizePartnershipStage(contact.stage)]
            const selectedId = selected?.id === contact.id
            const dueIn = daysUntil(contact.next_follow_up || contact.next_queue_due)
            return (
              <button
                key={contact.id}
                onClick={() => void openContact(contact)}
                className={`w-full border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${selectedId ? 'bg-slate-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 h-11 w-1.5 rounded-full ${contact.needs_follow_up ? 'bg-rose-500' : contact.pipeline === 'corporate' ? 'bg-sky-500' : 'bg-[#1a2744]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#1a2744]">{contact.name}</div>
                        <div className="truncate text-xs text-slate-500">{contact.company || contact.industry || 'Unassigned company'}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${meta.color}`}>
                        {meta.shortLabel}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>{contact.pipeline === 'corporate' ? 'Corporate' : 'Partner'}</span>
                      {contact.city && <span>• {contact.city}</span>}
                      {contact.tracking_code && <span>• {contact.tracking_code}</span>}
                      {(contact.mailed_at || contact.last_direct_mail_at) && <span>• mailed {fmtDate(contact.mailed_at || contact.last_direct_mail_at)}</span>}
                      {contact.last_call_at && <span>• called {fmtDate(contact.last_call_at)}</span>}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                      <span className={`${contact.needs_follow_up ? 'text-rose-600' : 'text-slate-400'}`}>
                        {contact.next_follow_up ? `follow-up ${dueIn !== null && dueIn < 0 ? `${Math.abs(dueIn)}d overdue` : dueIn === 0 ? 'today' : `in ${dueIn}d`}` : 'no follow-up date'}
                      </span>
                      <span className="text-slate-400">{contact.touch_count} touches</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-[26px] border border-[var(--app-line)] bg-white">
        {!selected ? (
          <div className="flex min-h-[620px] items-center justify-center p-10 text-center text-sm text-slate-500">Select an account to work the relationship.</div>
        ) : (
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr),360px]">
            <div className="border-b border-slate-200 p-6 xl:border-b-0 xl:border-r">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-[#1a2744]">{selected.name}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PARTNERSHIP_STAGE_META[normalizePartnershipStage(selected.stage)].color}`}>
                      {PARTNERSHIP_STAGE_META[normalizePartnershipStage(selected.stage)].label}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {[selected.title, selected.company || selected.industry, selected.city].filter(Boolean).join(' · ') || 'Partnership target'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                    {selected.phone && <a href={`tel:${selected.phone}`} className="rounded-full bg-slate-100 px-3 py-1.5 hover:text-[#1a2744]">📞 {selected.phone}</a>}
                    {selected.email && <a href={`mailto:${selected.email}`} className="rounded-full bg-slate-100 px-3 py-1.5 hover:text-[#1a2744]">✉️ {selected.email}</a>}
                    {selected.website && <a href={selected.website} target="_blank" rel="noreferrer" className="rounded-full bg-slate-100 px-3 py-1.5 hover:text-[#1a2744]">Website ↗</a>}
                  </div>
                </div>
                <div className="grid min-w-[220px] grid-cols-2 gap-3 rounded-[20px] border border-slate-200 bg-slate-50 p-4 text-sm">
                  <Metric label="Mail Sent" value={fmtDate(selected.mailed_at || selected.last_direct_mail_at)} />
                  <Metric label="Next Follow-Up" value={fmtDate(selected.next_follow_up)} />
                  <Metric label="Last Call" value={fmtDate(selected.last_call_at)} />
                  <Metric label="Pending Tasks" value={String(selected.pending_queue_count)} />
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <button onClick={() => void quickAction('mark_mail_sent')} disabled={saving} className="rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-left transition hover:bg-amber-100 disabled:opacity-60">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Mail</div>
                  <div className="mt-2 text-sm font-semibold text-[#1a2744]">Mark Mail Sent</div>
                  <div className="mt-1 text-xs text-slate-500">Logs the mail touch and sets a 21-day follow-up.</div>
                </button>
                <button onClick={() => void quickAction('mark_follow_up_due')} disabled={saving} className="rounded-[18px] border border-rose-200 bg-rose-50 p-4 text-left transition hover:bg-rose-100 disabled:opacity-60">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">Urgent</div>
                  <div className="mt-2 text-sm font-semibold text-[#1a2744]">Needs Follow-Up Now</div>
                  <div className="mt-1 text-xs text-slate-500">Pull this account into the active rep queue immediately.</div>
                </button>
                <button onClick={() => void quickAction('mark_partnership_active')} disabled={saving} className="rounded-[18px] border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100 disabled:opacity-60">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Won</div>
                  <div className="mt-2 text-sm font-semibold text-[#1a2744]">Partnership Secured</div>
                  <div className="mt-1 text-xs text-slate-500">Use this when they have replied positively or agreed to refer.</div>
                </button>
                <button onClick={() => void quickAction('snooze_21_days')} disabled={saving} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 text-left transition hover:bg-slate-100 disabled:opacity-60">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Later</div>
                  <div className="mt-2 text-sm font-semibold text-[#1a2744]">Snooze 21 Days</div>
                  <div className="mt-1 text-xs text-slate-500">Keep the relationship warm without clogging the immediate queue.</div>
                </button>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Owner</h3>
                      <input value={ownerName} onChange={event => setOwnerName(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]" placeholder="Rep name" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Owner Email</h3>
                      <input value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]" placeholder="rep@company.com" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Priority</h3>
                      <select value={priority} onChange={event => setPriority(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]">
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Account Status</h3>
                      <select value={accountStatus} onChange={event => setAccountStatus(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]">
                        <option value="active">Active</option>
                        <option value="dormant">Dormant</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Meeting Booked</h3>
                      <input type="date" value={meetingBookedAt} onChange={event => setMeetingBookedAt(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Referral Count</h3>
                      <input type="number" min={0} value={referredLeadCount} onChange={event => setReferredLeadCount(Number(event.target.value))} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Partnership Outcome</h3>
                    <select value={partnershipOutcome} onChange={event => setPartnershipOutcome(event.target.value)} className="mt-2 h-11 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]">
                      <option value="">Not decided</option>
                      <option value="secured">Secured</option>
                      <option value="meeting_booked">Meeting booked</option>
                      <option value="nurture">Nurture</option>
                      <option value="declined">Declined</option>
                      <option value="not_fit">Not a fit</option>
                    </select>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Relationship Notes</h3>
                    <textarea
                      value={editNotes}
                      onChange={event => setEditNotes(event.target.value)}
                      className="mt-2 h-36 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]"
                      placeholder="What have we sent? Did they reply? Who is the gatekeeper? What script worked?"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-[220px,1fr]">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Next Follow-Up</h3>
                      <input
                        type="date"
                        value={editFollowUp || ''}
                        onChange={event => setEditFollowUp(event.target.value)}
                        className="mt-2 h-12 w-full rounded-[18px] border border-slate-200 bg-slate-50 px-4 text-sm text-[#1a2744] outline-none transition focus:border-[#1a2744]"
                      />
                    </div>
                    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold text-[#1a2744]">Rep Prompt</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        “Hi, this is Saturn Star Movers following up on the partnership package we mailed over. I wanted to confirm it reached you and see whether there’s a fit to support your clients or staff with relocations.”
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => void saveProfile()} disabled={saving} className="rounded-xl bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                      {saving ? 'Saving...' : 'Save Profile'}
                    </button>
                    {selected.website && (
                      <a href={selected.website} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-[#1a2744] hover:text-[#1a2744]">
                        Open Website
                      </a>
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Log Outreach</h3>
                    <span className="text-xs text-slate-400">Every touch should live here.</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Channel</label>
                      <select
                        value={logForm.channel}
                        onChange={event => setLogForm(current => ({ ...current, channel: event.target.value }))}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none"
                      >
                        {CHANNELS.map(channel => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Stage After Touch</label>
                      <select
                        value={logForm.new_stage}
                        onChange={event => setLogForm(current => ({ ...current, new_stage: event.target.value }))}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none"
                      >
                        <option value="">Auto</option>
                        {PARTNERSHIP_STAGE_ORDER.map(stage => (
                          <option key={stage} value={stage}>{PARTNERSHIP_STAGE_META[stage].label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Outcome</label>
                      <select
                        value={logForm.outcome_code}
                        onChange={event => setLogForm(current => ({ ...current, outcome_code: event.target.value }))}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none"
                      >
                        {OUTCOME_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Next Follow-Up (days)</label>
                      <input
                        type="number"
                        min={0}
                        value={logForm.schedule_follow_up_days}
                        onChange={event => setLogForm(current => ({ ...current, schedule_follow_up_days: Number(event.target.value) }))}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Next Step</label>
                      <input
                        value={logForm.next_step}
                        onChange={event => setLogForm(current => ({ ...current, next_step: event.target.value }))}
                        className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#1a2744] outline-none"
                        placeholder="Send postcard, call office manager, book coffee..."
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">What happened?</label>
                      <textarea
                        value={logForm.notes}
                        onChange={event => setLogForm(current => ({ ...current, notes: event.target.value }))}
                        className="mt-1 h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-[#1a2744] outline-none"
                        placeholder="Left voicemail, confirmed package arrived, gatekeeper asked for another postcard, booked meeting..."
                      />
                    </div>
                    <button onClick={() => void logTouch()} disabled={saving || !logForm.notes.trim()} className="w-full rounded-xl bg-[#1a2744] py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                      Log Touch
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <aside className="p-6">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Timeline</h3>
                  <span className="text-xs text-slate-400">{touches.length} events</span>
                </div>
                <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {touchLoading ? (
                    <div className="text-sm text-slate-500">Loading activity...</div>
                  ) : touches.length === 0 ? (
                    <div className="rounded-[18px] border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      No touches logged yet. Start by marking the original mail or logging the latest follow-up call.
                    </div>
                  ) : touches.map(touch => (
                    <div key={touch.id} className="rounded-[18px] border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-600">{touch.channel.replace('_', ' ')}</span>
                        <span className="text-[11px] text-slate-400">{fmtDate(touch.created_at)}</span>
                      </div>
                      {touch.outcome_code && (
                        <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{touch.outcome_code.replace(/_/g, ' ')}</div>
                      )}
                      <div className="mt-2 text-sm leading-6 text-slate-700">{touch.notes || 'No note provided.'}</div>
                      {touch.next_step && <div className="mt-2 text-xs text-[#1a2744]">Next: {touch.next_step}</div>}
                      {touch.next_follow_up_on && <div className="mt-1 text-[11px] text-slate-400">Follow up on {fmtDate(touch.next_follow_up_on)}</div>}
                      <div className="mt-2 text-[11px] text-slate-400">{touch.created_by || 'Rep'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#1a2744]">{value}</div>
    </div>
  )
}

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="rounded-[24px] border border-[var(--app-line)] bg-white p-16 text-center text-sm text-slate-500">Loading partnerships...</div>}>
      <PartnersInner />
    </Suspense>
  )
}
