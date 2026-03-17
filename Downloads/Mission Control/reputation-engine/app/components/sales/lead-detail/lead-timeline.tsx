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
}: Props) {
  const [filter, setFilter] = useState<TimelineFilter>('all')

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
                  onLeadUpdate={onLeadUpdate}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--app-line)] bg-[var(--app-bg)] p-4">
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
          {consultationActive ? (
            <div className="mb-4 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="crm-label text-emerald-700">In-house Consultation Recording</div>
                  <div className="mt-1 text-sm font-medium text-emerald-900">Recording live • {formatSeconds(consultationSeconds)}</div>
                </div>
                <div className="h-3 w-3 rounded-full bg-rose-500" />
              </div>
              <textarea
                value={consultationNotes}
                onChange={event => onConsultationNotesChange(event.target.value)}
                className="mt-4 min-h-[88px] w-full resize-none rounded-[8px] border border-emerald-200 bg-white px-3 py-3 text-sm outline-none"
                placeholder="Log what was discussed during the walkthrough or consultation..."
              />
              <textarea
                value={consultationSummary}
                onChange={event => onConsultationSummaryChange(event.target.value)}
                className="mt-3 min-h-[72px] w-full resize-none rounded-[8px] border border-emerald-200 bg-white px-3 py-3 text-sm outline-none"
                placeholder="Add a short summary or next step for the team..."
              />
              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  onClick={onStopConsultation}
                  disabled={consultationSaving}
                  className="crm-button-dark disabled:opacity-60"
                >
                  {consultationSaving ? 'Saving...' : 'Stop + Save Consultation'}
                </button>
              </div>
            </div>
          ) : null}
          <textarea
            value={activityNotes}
            onChange={event => onActivityNotesChange(event.target.value)}
            className="min-h-[72px] w-full resize-none bg-transparent text-sm outline-none"
            placeholder="Add a note for the team..."
          />
          <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3">
            <div className="text-xs text-[var(--app-muted)]">Logs to the living timeline instantly.</div>
            <div className="flex items-center gap-3">
              <select value={activityType} onChange={event => onActivityTypeChange(event.target.value as FollowUpLog['type'])} className="crm-input max-w-[120px] py-2">
                <option value="call">Call</option>
                <option value="note">Note</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="visit">Visit</option>
                <option value="consultation">Consultation</option>
              </select>
              <button onClick={onLogActivity} disabled={loggingActivity || !activityNotes.trim()} className="crm-button-dark disabled:opacity-60">
                {loggingActivity ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
