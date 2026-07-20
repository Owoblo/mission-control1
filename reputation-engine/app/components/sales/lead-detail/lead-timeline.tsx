'use client'

import { useMemo, useState, useCallback } from 'react'
import type { CRMLead, CRMQuote, FollowUpLog } from '@/lib/types'
import { TimelineEventCard } from './timeline-event-card'
import type { TimelineItem } from './timeline-types'

type Props = {
  lead: CRMLead
  quote: CRMQuote | null
  timeline: TimelineItem[]
  inventoryCubicFeet: number
  activityType: FollowUpLog['type']
  activityNotes: string
  loggingActivity: boolean
  consultationActive: boolean
  consultationSaving: boolean
  consultationNotes: string
  consultationSummary: string
  consultationSeconds: number
  onActivityTypeChange: (value: FollowUpLog['type']) => void
  onActivityNotesChange: (value: string) => void
  onLogActivity: () => void
  onOpenQuoteBuilder: () => void
  onStartConsultation: () => void
  onConsultationNotesChange: (value: string) => void
  onConsultationSummaryChange: (value: string) => void
  onStopConsultation: () => void
  onLeadUpdate?: (lead: CRMLead) => void
  onNoteAdded?: (note: FollowUpLog) => void
  readOnly?: boolean
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

type TimelineFilter = 'sales' | 'engagement' | 'audit' | 'all'

function isCustomerEngagementItem(item: TimelineItem) {
  return (
    item.actor === 'customer' ||
    item.kind === 'call' ||
    item.kind === 'consultation' ||
    item.kind === 'sms' ||
    item.kind === 'email' ||
    item.kind === 'view' ||
    item.kind === 'accept' ||
    item.kind === 'decline' ||
    item.kind === 'quote viewed' ||
    item.kind === 'quote accepted' ||
    item.kind === 'quote declined'
  )
}

function isAuditItem(item: TimelineItem) {
  return item.kind === 'quote draft' || item.kind === 'status_change' || (item.actor === 'system' && !isCustomerEngagementItem(item))
}

export function LeadTimeline({
  lead,
  quote,
  timeline,
  inventoryCubicFeet,
  activityType,
  activityNotes,
  loggingActivity,
  consultationActive,
  consultationSaving,
  consultationNotes,
  consultationSummary,
  consultationSeconds,
  onActivityTypeChange,
  onActivityNotesChange,
  onLogActivity,
  onOpenQuoteBuilder,
  onStartConsultation,
  onConsultationNotesChange,
  onConsultationSummaryChange,
  onStopConsultation,
  onLeadUpdate,
  onNoteAdded,
  readOnly,
}: Props) {
  const [filter, setFilter] = useState<TimelineFilter>('engagement')
  const [quickNote, setQuickNote] = useState('')
  const [postingNote, setPostingNote] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  const pendingTranscriptionCount = useMemo(() => {
    return (lead.callLogs || []).filter(call => {
      const recordingUrl = call.recordingUrl || ''
      return (
        !call.transcript &&
        (
          recordingUrl.startsWith('https://api.twilio.com/') ||
          recordingUrl.startsWith('/api/sales/dialer/recording?key=')
        )
      )
    }).length
  }, [lead.callLogs])

  const syncCalls = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/sync-calls`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json() as { ok?: boolean; lead?: CRMLead; synced?: number }
        if (data.lead) onLeadUpdate?.(data.lead)
      }
    } catch {
      // best-effort
    } finally {
      setSyncing(false)
    }
  }, [lead.id, syncing, onLeadUpdate])

  const transcribeCalls = useCallback(async () => {
    if (transcribing || pendingTranscriptionCount === 0) return
    setTranscribing(true)
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/transcribe-calls`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json() as { ok?: boolean; lead?: CRMLead; transcribed?: number }
        if (data.lead) onLeadUpdate?.(data.lead)
      }
    } catch {
      // best-effort
    } finally {
      setTranscribing(false)
    }
  }, [lead.id, pendingTranscriptionCount, transcribing, onLeadUpdate])

  async function handlePostNote() {
    if (!quickNote.trim() || postingNote || readOnly) return
    setPostingNote(true)
    try {
      const res = await fetch('/api/sales/leads/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, text: quickNote.trim() }),
      })
      if (res.ok) {
        const data = await res.json() as { ok: boolean; log: FollowUpLog }
        setQuickNote('')
        onNoteAdded?.(data.log)
      }
    } finally {
      setPostingNote(false)
    }
  }

  const filteredTimeline = useMemo(() => {
    if (filter === 'all') return timeline
    if (filter === 'engagement') return timeline.filter(item => isCustomerEngagementItem(item))
    if (filter === 'audit') return timeline.filter(item => isAuditItem(item))
    if (filter === 'sales') return timeline.filter(item => !isAuditItem(item) || item.kind === 'view' || item.kind === 'accept' || item.kind === 'decline')
    return timeline
  }, [filter, timeline])

  return (
    <section className="flex min-h-[680px] flex-col bg-[var(--app-bg)]">
      <div className="flex flex-col gap-3 border-b border-[var(--app-line)] bg-[var(--app-bg)] px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-[var(--app-ink)]">Job narrative</h2>
          <button
            type="button"
            onClick={() => void syncCalls()}
            disabled={syncing}
            title="Pull latest calls from Twilio — captures calls made by any rep"
            className="rounded-full border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-muted)] transition hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] disabled:opacity-50"
          >
            {syncing ? '↻ Syncing…' : '↻ Sync calls'}
          </button>
          {pendingTranscriptionCount > 0 ? (
            <button
              type="button"
              onClick={() => void transcribeCalls()}
              disabled={transcribing}
              title="Transcribe recordings that are already saved but missing transcript text"
              className="rounded-full border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-muted)] transition hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] disabled:opacity-50"
            >
              {transcribing ? 'Transcribing…' : `Transcribe ${pendingTranscriptionCount}`}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[var(--app-muted)]">
          {[
            ['engagement', 'Meaningful activity'],
            ['sales', 'Sales history'],
            ['audit', 'System Audit'],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value as TimelineFilter)}
              className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                filter === value
                  ? 'border-[var(--app-accent)] bg-[rgba(15,106,83,0.08)] text-[var(--app-accent)]'
                  : 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Quick note / recording bar */}
        <div className="mb-6 flex items-center gap-2">
          {readOnly ? (
            <div className="w-full rounded-[8px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              This lead is view-only for you. Open your own lead or ask a manager to reassign it before logging notes or changing the timeline.
            </div>
          ) : null}
          {consultationActive ? (
            <>
              <div className="flex flex-1 items-center gap-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                <span className="text-sm font-medium text-emerald-900">Recording live • {formatSeconds(consultationSeconds)}</span>
              </div>
              <button
                type="button"
                onClick={onStopConsultation}
                disabled={consultationSaving}
                className="shrink-0 rounded-[8px] bg-[#071421] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50"
              >
                {consultationSaving ? 'Saving…' : 'Stop + Save'}
              </button>
            </>
          ) : (
            <>
              <textarea
                value={quickNote}
                onChange={event => setQuickNote(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    void handlePostNote()
                  }
                }}
                rows={1}
                disabled={readOnly}
                className="flex-1 resize-none rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-[#071421] focus:ring-1 focus:ring-[#071421]"
                placeholder="Add a note…"
              />
              <button
                type="button"
                onClick={() => void handlePostNote()}
                disabled={readOnly || postingNote || !quickNote.trim()}
                className="shrink-0 rounded-[8px] bg-[#071421] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50"
              >
                {postingNote ? 'Posting…' : 'Post'}
              </button>
            </>
          )}
        </div>

        <div className="relative">
          <div className="absolute bottom-0 left-[15px] top-0 w-px bg-[rgba(228,226,220,1)]" />
          <div className="space-y-8 pb-8">
            {filteredTimeline.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-stone-200 px-5 py-8 text-sm text-stone-400">No activity logged yet.</div>
            ) : (
              filteredTimeline.map((item, index) => (
                <TimelineEventCard
                  key={item.id}
                  item={item}
                  expandedByDefault={index === 0}
                  quote={quote}
                  inventoryCubicFeet={inventoryCubicFeet}
                  onOpenQuoteBuilder={onOpenQuoteBuilder}
                  leadId={lead.id}
                  lead={lead}
                  onLeadUpdate={onLeadUpdate}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--app-line)] bg-[var(--app-bg)] p-4">
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
          <textarea
            value={activityNotes}
            onChange={event => onActivityNotesChange(event.target.value)}
            disabled={readOnly}
            className="min-h-[72px] w-full resize-none bg-transparent text-sm outline-none"
            placeholder="Add a note for the team..."
          />
          <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3">
            <div className="text-xs text-[var(--app-muted)]">Logs to the living timeline instantly.</div>
            <div className="flex items-center gap-3">
              <select value={activityType} onChange={event => onActivityTypeChange(event.target.value as FollowUpLog['type'])} disabled={readOnly} className="crm-input max-w-[120px] py-2">
                <option value="call">Call</option>
                <option value="note">Note</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="visit">Visit</option>
                <option value="consultation">Consultation</option>
              </select>
              <button onClick={onLogActivity} disabled={readOnly || loggingActivity || !activityNotes.trim()} className="crm-button-dark disabled:opacity-60">
                {loggingActivity ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
