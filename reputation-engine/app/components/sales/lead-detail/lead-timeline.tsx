'use client'

import { useMemo, useState } from 'react'
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

type TimelineFilter = 'all' | 'calls' | 'messages' | 'quotes' | 'consultations'

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
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [quickNote, setQuickNote] = useState('')
  const [postingNote, setPostingNote] = useState(false)

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
    if (filter === 'calls') return timeline.filter(item => item.kind === 'call')
    if (filter === 'messages') return timeline.filter(item => item.kind === 'sms' || item.kind === 'email')
    if (filter === 'quotes') return timeline.filter(item => item.kind.includes('quote') || item.kind === 'view' || item.kind === 'accept' || item.kind === 'decline')
    if (filter === 'consultations') return timeline.filter(item => item.kind === 'consultation')
    return timeline
  }, [filter, timeline])

  return (
    <section className="flex min-h-[760px] flex-col bg-[var(--app-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-bg)] px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-[var(--app-ink)]">Living Timeline</h2>
          <span className="rounded-full bg-[rgba(228,226,220,1)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-ink)]">Recent First</span>
        </div>
        <div className="flex items-center gap-2 text-[var(--app-muted)]">
          {[
            ['all', 'All'],
            ['calls', 'Calls'],
            ['messages', 'Messages'],
            ['quotes', 'Quotes'],
            ['consultations', 'Consultations'],
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
                className="shrink-0 rounded-[8px] bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50"
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
                className="flex-1 resize-none rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-[#1a2744] focus:ring-1 focus:ring-[#1a2744]"
                placeholder="Add a note…"
              />
              <button
                type="button"
                onClick={() => void handlePostNote()}
                disabled={readOnly || postingNote || !quickNote.trim()}
                className="shrink-0 rounded-[8px] bg-[#1a2744] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#243560] disabled:opacity-50"
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
