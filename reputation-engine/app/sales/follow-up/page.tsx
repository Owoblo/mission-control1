'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteSalesLead, fetchSalesOverview, saveSalesFollowUp, updateSalesLead } from '@/lib/sales-api'
import { FOLLOW_UP_STATUSES, formatDate, formatMoney, isClosedLeadStage } from '@/lib/sales'
import type { CRMLead, CRMQuote, LeadFollowUpStatus } from '@/lib/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function daysSince(iso?: string | null): number {
  if (!iso) return 999
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function daysUntil(iso?: string | null): number {
  if (!iso) return 999
  return Math.ceil((new Date(iso).setHours(12, 0, 0, 0) - new Date().setHours(12, 0, 0, 0)) / 86_400_000)
}

function lastContactDate(lead: CRMLead): string | null {
  const candidates: string[] = []
  if (lead.lastInboundAt) candidates.push(lead.lastInboundAt)
  if (lead.followUpDate) candidates.push(lead.followUpDate)
  const lastCall = lead.callLogs?.[0]?.date
  if (lastCall) candidates.push(lastCall)
  if (!candidates.length) return lead.createdAt || null
  return candidates.sort().reverse()[0]
}

function urgencyScore(lead: CRMLead): number {
  const fu = daysUntil(lead.followUpDate)
  const contact = daysSince(lastContactDate(lead))
  // Lower score = more urgent
  if (fu <= 0) return fu - 100           // overdue follow-up
  if (fu === 1) return -50               // due today
  if (contact >= 7) return contact       // gone silent
  if (contact >= 3) return contact + 50
  return fu + 100
}

function stageColor(stage: string) {
  const map: Record<string, string> = {
    new: 'border border-[rgba(49,94,173,0.12)] bg-[rgba(49,94,173,0.08)] text-[#315ead]',
    contacted: 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
    pricing: 'border border-[rgba(217,119,6,0.12)] bg-[#fbf2e4] text-[#9a5a00]',
    quoted: 'border border-[rgba(201,117,78,0.14)] bg-[#f6ece7] text-[#9b5a3c]',
    nurture: 'border border-[rgba(108,92,164,0.12)] bg-[rgba(108,92,164,0.08)] text-[#6c5ca4]',
    booked: 'border border-[rgba(15,106,83,0.12)] bg-[rgba(15,106,83,0.1)] text-[var(--app-accent)]',
    lost: 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[#6f736a]',
  }
  return map[stage] || 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[#6f736a]'
}

function contactAgeBadge(days: number) {
  if (days <= 1) return { label: 'Today', cls: 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' }
  if (days <= 2) return { label: `${days}d ago`, cls: 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]' }
  if (days <= 5) return { label: `${days}d ago`, cls: 'border border-[rgba(217,119,6,0.12)] bg-[#fbf2e4] text-[#9a5a00]' }
  return { label: `${days}d ago`, cls: 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]' }
}

const UPDATE_OPTIONS = [
  { id: 'called_no_answer', label: 'Called — no answer' },
  { id: 'left_voicemail', label: 'Left voicemail' },
  { id: 'sms_sent', label: 'Texted — awaiting reply' },
  { id: 'emailed', label: 'Emailed — awaiting reply' },
  { id: 'spoke_with_lead', label: 'Spoke with them' },
  { id: 'not_ready_yet', label: 'Not ready yet — following up' },
  { id: 'waiting_on_them', label: 'Waiting on their decision' },
  { id: 'hard_no', label: 'Hard no — marking lost' },
]

const UPDATE_STATUS_MAP: Record<string, LeadFollowUpStatus> = {
  called_no_answer: 'following_up',
  left_voicemail: 'following_up',
  sms_sent: 'following_up',
  emailed: 'following_up',
  spoke_with_lead: 'followed_up',
  not_ready_yet: 'pending',
  waiting_on_them: 'pending',
  hard_no: 'followed_up',
}

function followUpStatusMeta(status?: LeadFollowUpStatus | '') {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        cls: 'border border-[rgba(217,119,6,0.12)] bg-[#fbf2e4] text-[#9a5a00]',
        activeCls: 'border border-[rgba(217,119,6,0.16)] bg-[#f5e6c8] text-[#8a4f00]',
      }
    case 'following_up':
      return {
        label: 'Following Up',
        cls: 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
        activeCls: 'border border-[rgba(15,106,83,0.18)] bg-[#deefe8] text-[#0a5b47]',
      }
    case 'followed_up':
      return {
        label: 'Followed Up',
        cls: 'border border-[rgba(62,111,93,0.12)] bg-[#edf4f0] text-[#3a6f5d]',
        activeCls: 'border border-[rgba(62,111,93,0.18)] bg-[#dfece5] text-[#315d4f]',
      }
    case 'no_response':
      return {
        label: 'No Response',
        cls: 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]',
        activeCls: 'border border-[rgba(201,117,78,0.16)] bg-[#eeddd5] text-[#8a4e35]',
      }
    default:
      return {
        label: 'Pending',
        cls: 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[#6f736a]',
        activeCls: 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[#4f534c]',
      }
  }
}

function urgencyTone(lead: CRMLead) {
  const fuDays = daysUntil(lead.followUpDate)
  const overdue = Boolean(lead.followUpDate && fuDays < 0)
  const dueToday = Boolean(lead.followUpDate && fuDays === 0)
  const quietForDays = daysSince(lastContactDate(lead))

  if (overdue) {
    return {
      card: 'border-[#e6d1ca] bg-[linear-gradient(180deg,#ffffff_0%,#fff8f6_100%)]',
      bar: 'bg-[#c9754e]',
      flag: 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]',
      label: 'Past due',
    }
  }

  if (dueToday) {
    return {
      card: 'border-[#eadfcb] bg-[linear-gradient(180deg,#ffffff_0%,#fffcf6_100%)]',
      bar: 'bg-[#d0a24d]',
      flag: 'border border-[rgba(217,119,6,0.12)] bg-[#fbf2e4] text-[#9a5a00]',
      label: 'Due today',
    }
  }

  if (quietForDays >= 5) {
    return {
      card: 'border-[#dbe7e1] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbfa_100%)]',
      bar: 'bg-[rgba(15,106,83,0.35)]',
      flag: 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
      label: 'Re-engage',
    }
  }

  return {
    card: 'border-[var(--app-line)] bg-white',
    bar: 'bg-[var(--app-line)]',
    flag: 'border border-[var(--app-line)] bg-[var(--app-wash)] text-[#6f736a]',
    label: 'Active',
  }
}

// ─── NoteModal ────────────────────────────────────────────────────────────────

function NoteModal({ lead, onClose, onSaved }: {
  lead: CRMLead
  onClose: () => void
  onSaved: (lead: CRMLead) => void
}) {
  const [updateType, setUpdateType] = useState('')
  const [detail, setDetail] = useState('')
  const [snoozeDate, setSnoozeDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const isLost = updateType === 'hard_no'
  const followUpStatus = UPDATE_STATUS_MAP[updateType] || 'pending'

  async function save() {
    if (!updateType) { setError('Pick an update type'); return }
    setBusy(true)
    setError(null)
    try {
      const label = UPDATE_OPTIONS.find(o => o.id === updateType)?.label || updateType
      const notes = detail.trim() ? `${label}: ${detail.trim()}` : label
      const followUpDate = isLost ? undefined : (snoozeDate || tomorrow)

      await saveSalesFollowUp({
        leadId: lead.id,
        type: 'note',
        notes,
        followUpDate,
        followUpStatus,
      })

      const updates: Partial<CRMLead> = {
        followUpDate,
        followUpNote: notes,
        followUpStatus,
        ...(isLost ? { stage: 'lost' } : {}),
      }
      const saved = await updateSalesLead(lead.id, updates)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[16px] bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--app-line)]">
          <div className="text-sm font-semibold text-[var(--app-ink)]">Log follow-up — {lead.name || lead.phone}</div>
          <div className="text-[11px] text-[var(--app-muted)] mt-0.5">What's the update on this lead?</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {UPDATE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setUpdateType(opt.id)}
                className={`rounded-[8px] border px-3 py-2 text-left text-xs font-medium transition ${
                  updateType === opt.id
                    ? opt.id === 'hard_no'
                      ? 'border-rose-500 bg-rose-500 text-white'
                      : 'border-[var(--app-accent)] bg-[var(--app-accent)] text-white'
                    : 'border-[var(--app-line)] text-[var(--app-ink)] hover:border-[var(--app-accent)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <textarea
            value={detail}
            onChange={e => setDetail(e.target.value)}
            placeholder="Additional detail (optional)..."
            rows={2}
            className="crm-input w-full resize-none text-sm"
          />

          {!isLost && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--app-muted)] shrink-0">Follow up on:</span>
              <input
                type="date"
                value={snoozeDate || tomorrow}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => setSnoozeDate(e.target.value)}
                className="crm-input flex-1 text-sm"
              />
            </div>
          )}

          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>
        <div className="px-5 pb-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-[8px] border border-[var(--app-line)] py-2 text-sm text-[var(--app-muted)] hover:border-[var(--app-ink)] transition">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!updateType || busy}
            className={`flex-1 rounded-[8px] py-2 text-sm font-semibold text-white disabled:opacity-50 transition ${
              isLost ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[var(--app-accent)] hover:opacity-90'
            }`}
          >
            {busy ? 'Saving...' : isLost ? 'Mark Lost & Move On' : 'Log & Snooze'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Static brief ────────────────────────────────────────────────────────────

function buildStaticBrief(lead: CRMLead, quote?: CRMQuote | null): string[] {
  const points: string[] = []
  if (lead.originCity || lead.destCity) {
    points.push(`Route: ${lead.originCity || '?'} → ${lead.destCity || '?'}${lead.moveDate ? ` on ${formatDate(lead.moveDate)}` : ''}`)
  }
  if (quote) {
    if (quote.status === 'accepted') points.push(`Quote accepted — ${quote.total ? formatMoney(quote.total) : ''} — job booked`)
    else if (quote.viewedAt) points.push(`Quote viewed${quote.total ? ` (${formatMoney(quote.total)})` : ''} — no reply since ${quote.viewedAt.slice(0, 10)}`)
    else if (quote.sentAt) points.push(`Quote sent${quote.total ? ` ${formatMoney(quote.total)}` : ''} on ${quote.sentAt.slice(0, 10)} — not opened yet`)
    else points.push('Quote drafted but not sent')
  } else {
    points.push('No quote sent yet')
  }
  if (lead.followUpNote) points.push(`Last note: "${lead.followUpNote.slice(0, 80)}${lead.followUpNote.length > 80 ? '…' : ''}"`)
  const calls = lead.callLogs || []
  if (calls.length > 0) {
    const last = calls[0]
    const dir = last.direction === 'inbound' ? 'called us' : 'we called'
    points.push(`Last call ${last.date?.slice(0, 10) || ''} — ${dir}${last.notes ? ` · ${last.notes.slice(0, 60)}` : ''}`)
  }
  return points
}

// ─── LeadCard ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, quote, onNote }: { lead: CRMLead; quote?: CRMQuote | null; onNote: (lead: CRMLead) => void }) {
  const contactDays = daysSince(lastContactDate(lead))
  const ageBadge = contactAgeBadge(contactDays)
  const fuDays = daysUntil(lead.followUpDate)
  const overdue = lead.followUpDate && fuDays < 0
  const dueToday = lead.followUpDate && fuDays === 0
  const tone = urgencyTone(lead)
  const staticBrief = buildStaticBrief(lead, quote)
  const [aiBullets, setAiBullets] = useState<string[] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const statusMeta = followUpStatusMeta(lead.followUpStatus)

  async function fetchAiBrief() {
    if (aiBullets) { setBriefOpen(b => !b); return }
    setAiBusy(true)
    setBriefOpen(true)
    try {
      const res = await fetch('/api/sales/leads/call-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadId: lead.id }),
      })
      const data = (await res.json()) as { bullets?: string[] }
      setAiBullets(data.bullets || [])
    } catch { setAiBullets(['Could not generate brief — check network']) }
    finally { setAiBusy(false) }
  }

  function callLead() {
    if (lead.phone) window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, name: lead.name, leadId: lead.id } }))
  }

  function smsLead() {
    if (lead.phone) window.open(`sms:${lead.phone}`)
  }

  return (
    <div className={`rounded-[14px] border p-4 shadow-sm transition hover:shadow-md ${tone.card}`}>
      <div className={`mb-4 h-1 rounded-full ${tone.bar}`} />
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/sales/leads/${lead.id}`} className="text-sm font-semibold text-[var(--app-ink)] hover:text-[var(--app-accent)] transition">
              {lead.name || lead.phone || 'Unknown'}
            </Link>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${stageColor(lead.stage)}`}>
              {lead.stage?.replace(/_/g, ' ')}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
            {(overdue || dueToday) && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.flag}`}>
                {tone.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--app-muted)]">
            {lead.phone && <span>{lead.phone}</span>}
            {lead.moveDate && <span>Move: {formatDate(lead.moveDate)}</span>}
            {lead.originCity && lead.destCity && <span>{lead.originCity} → {lead.destCity}</span>}
            {lead.assignedRepName && (
              <span className="font-medium text-[var(--app-ink)]">Rep: {lead.assignedRepName}</span>
            )}
          </div>
        </div>
        {/* Contact age */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ageBadge.cls}`}>
          {ageBadge.label}
        </span>
      </div>

      {/* Next follow-up */}
      {lead.followUpDate && (
        <div className={`mt-2 text-[10px] font-medium ${overdue ? 'text-[#9b5a3c]' : dueToday ? 'text-[#9a5a00]' : 'text-[var(--app-muted)]'}`}>
          {overdue ? `Follow-up was ${Math.abs(fuDays)}d ago` : dueToday ? 'Follow up today' : `Follow up ${formatDate(lead.followUpDate)}`}
        </div>
      )}

      {/* Pre-call brief */}
      <div className="mt-2">
        <button
          onClick={() => void fetchAiBrief()}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--app-accent)] hover:opacity-80 transition"
        >
          <span>{briefOpen ? '▼' : '▶'}</span>
          {aiBusy ? 'Building brief…' : aiBullets ? 'Pre-call brief' : 'Load pre-call brief'}
        </button>

        {briefOpen && (
          <div className="mt-2 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 space-y-2">
            {/* Static facts always shown */}
            <div className="space-y-1">
              {staticBrief.map((point, i) => (
                <div key={i} className="text-[11px] text-[var(--app-muted)] leading-relaxed">{point}</div>
              ))}
            </div>
            {/* AI talking points */}
            {aiBullets && aiBullets.length > 0 && (
              <div className="border-t border-[var(--app-line)] pt-2 space-y-1.5">
                <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--app-accent)]">AI talking points</div>
                {aiBullets.map((b, i) => (
                  <div key={i} className="flex gap-2 text-[11px] text-[var(--app-ink)] leading-relaxed">
                    <span className="shrink-0 text-[var(--app-accent)]">•</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {lead.phone && (
          <button onClick={callLead} className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            Call
          </button>
        )}
        {lead.phone && (
          <button onClick={smsLead} className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
            Text
          </button>
        )}
        <Link href={`/sales/leads/${lead.id}`} className="flex-1 rounded-[8px] border border-[var(--app-line)] py-1.5 text-center text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)] transition">
          Open Lead
        </Link>
        <button
          onClick={() => onNote(lead)}
          className="flex-1 rounded-[8px] bg-[var(--app-accent)] py-1.5 text-xs font-semibold text-white hover:opacity-90 transition"
        >
          Log Update
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'overdue' | 'today' | 'week' | 'silent'

export default function FollowUpWallPage() {
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [noteTarget, setNoteTarget] = useState<CRMLead | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | LeadFollowUpStatus>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(l => l.id)))
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkBusy(true)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => deleteSalesLead(id).catch(() => {})))
    setLeads(prev => prev.filter(l => !selectedIds.has(l.id)))
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  async function bulkMarkLost() {
    if (!confirm(`Mark ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''} as lost?`)) return
    setBulkBusy(true)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => updateSalesLead(id, { stage: 'lost' }).catch(() => {})))
    setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, stage: 'lost' as const } : l))
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  async function bulkSnooze() {
    setBulkBusy(true)
    const snoozeDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => updateSalesLead(id, { followUpDate: snoozeDate }).catch(() => {})))
    setLeads(prev => prev.map(l => selectedIds.has(l.id) ? { ...l, followUpDate: snoozeDate } : l))
    setSelectedIds(new Set())
    setBulkBusy(false)
  }

  async function load() {
    try {
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setQuotes(data.quotes)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // Only active leads that need follow-up (not booked/lost/completed)
  const actionableLeads = useMemo(() => {
    return leads.filter(lead => {
      if (isClosedLeadStage(lead.stage)) return false
      if (lead.stage === 'booked') return false
      return true
    })
  }, [leads])

  const filtered = useMemo(() => {
    let base = actionableLeads
    const q = search.trim().toLowerCase()
    if (q) base = base.filter(l => `${l.name} ${l.phone} ${l.email} ${l.originCity} ${l.destCity}`.toLowerCase().includes(q))

    const today = new Date().toISOString().slice(0, 10)
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

    switch (filter) {
      case 'overdue':
        base = base.filter(l => l.followUpDate && l.followUpDate < today)
        break
      case 'today':
        base = base.filter(l => l.followUpDate === today || (!l.followUpDate && daysSince(lastContactDate(l)) >= 1))
        break
      case 'week':
        base = base.filter(l => l.followUpDate && l.followUpDate <= weekOut)
        break
      case 'silent':
        base = base.filter(l => daysSince(lastContactDate(l)) >= 5)
        break
    }

    if (statusFilter !== 'all') {
      base = base.filter(l => l.followUpStatus === statusFilter)
    }

    return [...base].sort((a, b) => urgencyScore(a) - urgencyScore(b))
  }, [actionableLeads, filter, search, statusFilter])

  const counts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    return {
      all: actionableLeads.length,
      overdue: actionableLeads.filter(l => l.followUpDate && l.followUpDate < today).length,
      today: actionableLeads.filter(l => l.followUpDate === today || (!l.followUpDate && daysSince(lastContactDate(l)) >= 1)).length,
      week: actionableLeads.filter(l => l.followUpDate && l.followUpDate <= weekOut).length,
      silent: actionableLeads.filter(l => daysSince(lastContactDate(l)) >= 5).length,
    }
  }, [actionableLeads])

  function handleNoteSaved(updated: CRMLead) {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
    setNoteTarget(null)
  }

  const urgentCount = counts.overdue + counts.today

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--app-ink)]">Follow-Up Wall</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                urgentCount > 0
                  ? 'border border-[rgba(201,117,78,0.12)] bg-[#f6ece7] text-[#955941]'
                  : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
              }`}>
                <span className={`h-2.5 w-2.5 rounded-full ${urgentCount > 0 ? 'bg-[#c9754e]' : 'bg-[var(--app-accent)]'}`} />
                {urgentCount > 0
                  ? `${urgentCount} lead${urgentCount === 1 ? '' : 's'} need attention today`
                  : 'All caught up'}
              </span>
              {counts.overdue > 0 ? (
                <span className="rounded-full border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] px-2.5 py-1 text-xs font-semibold text-[#955941]">
                  {counts.overdue} overdue
                </span>
              ) : null}
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads..."
            className="crm-input w-64 text-sm"
          />
        </div>

        {/* Urgency banner */}
        {urgentCount > 0 && (
          <div className="mt-4 overflow-hidden rounded-[16px] border border-[#dbe7e1] bg-[linear-gradient(135deg,#f7fbf9_0%,#fffbf3_100%)]">
            <div className="h-1 bg-[linear-gradient(90deg,var(--app-accent)_0%,#c9754e_100%)]" />
            <div className="flex items-start gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgba(15,106,83,0.12)] bg-white text-sm font-semibold text-[var(--app-accent)]">
                {urgentCount}
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--app-ink)]">Work the wall first.</div>
                <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                  Close the overdue follow-ups before pulling in fresh work. Log the touch, get a yes or no, then move on cleanly.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: 'all', label: 'All Active', count: counts.all },
          { id: 'overdue', label: 'Overdue', count: counts.overdue },
          { id: 'today', label: 'Due Today', count: counts.today },
          { id: 'week', label: 'This Week', count: counts.week },
          { id: 'silent', label: 'Gone Silent 5d+', count: counts.silent },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              filter === tab.id
                ? 'bg-[var(--app-accent)] text-white shadow-sm'
                : 'border border-[var(--app-line)] bg-white text-[var(--app-ink)] hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`rounded-full px-1.5 text-[9px] font-bold ${
                filter === tab.id
                  ? 'bg-white/20 text-white'
                  : tab.id === 'overdue' ? 'border border-[rgba(201,117,78,0.12)] bg-[#f5ece7] text-[#955941]'
                  : tab.id === 'silent' ? 'border border-[rgba(217,119,6,0.12)] bg-[#fbf2e4] text-[#9a5a00]'
                  : 'border border-[rgba(15,106,83,0.12)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            statusFilter === 'all'
              ? 'bg-[var(--app-accent)] text-white'
              : 'border border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[var(--app-accent)]'
          }`}
        >
          All statuses
        </button>
        {FOLLOW_UP_STATUSES.map(status => {
          const meta = followUpStatusMeta(status.id)
          return (
            <button
              key={status.id}
              onClick={() => setStatusFilter(status.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === status.id
                  ? meta.activeCls
                  : meta.cls
              }`}
            >
              {status.label}
            </button>
          )
        })}
      </div>

      {/* Bulk select toolbar */}
      {filtered.length > 0 && !loading && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded accent-[var(--app-accent)]"
            />
            <span className="text-xs text-[var(--app-muted)]">
              {selectedIds.size === 0 ? 'Select all' : `${selectedIds.size} selected`}
            </span>
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 ml-2">
              <button onClick={() => void bulkSnooze()} disabled={bulkBusy}
                className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:bg-[var(--app-bg)] transition disabled:opacity-50">
                ⏰ Snooze 7 days
              </button>
              <button onClick={() => void bulkMarkLost()} disabled={bulkBusy}
                className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--app-muted)] hover:text-[var(--app-ink)] transition disabled:opacity-50">
                Mark Lost
              </button>
              <button onClick={() => void bulkDelete()} disabled={bulkBusy}
                className="rounded-[6px] border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50">
                {bulkBusy ? 'Working…' : `🗑 Delete ${selectedIds.size}`}
              </button>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[var(--app-muted)] hover:text-[var(--app-ink)] transition">
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lead grid */}
      {loading ? (
        <div className="text-center py-16 text-sm text-[var(--app-muted)]">Loading leads...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-sm font-semibold text-[var(--app-ink)]">Nothing here right now.</div>
          <div className="text-xs text-[var(--app-muted)] mt-1">Switch filters or check back later.</div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map(lead => {
            const leadQuote = quotes.find(q => q.leadId === lead.id) || null
            const isSelected = selectedIds.has(lead.id)
            return (
              <div key={lead.id} className="relative">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(lead.id)}
                  className="absolute left-3 top-3 z-10 h-4 w-4 cursor-pointer rounded accent-[var(--app-accent)]"
                />
                <div className={`transition ${isSelected ? 'ring-2 ring-[var(--app-accent)] ring-offset-1 rounded-[14px]' : ''}`}>
                  <LeadCard lead={lead} quote={leadQuote} onNote={setNoteTarget} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Note modal */}
      {noteTarget && (
        <NoteModal
          lead={noteTarget}
          onClose={() => setNoteTarget(null)}
          onSaved={handleNoteSaved}
        />
      )}
    </div>
  )
}
