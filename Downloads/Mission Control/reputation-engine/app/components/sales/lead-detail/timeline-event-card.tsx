'use client'

import { useState } from 'react'
import { formatDateTime, formatMoney } from '@/lib/sales'
import type { CRMQuote } from '@/lib/types'
import type { TimelineItem } from './timeline-types'

function kindLabel(kind: string) {
  if (kind === 'sms') return 'SMS'
  if (kind === 'email') return 'Email'
  if (kind === 'view') return 'Quote Viewed'
  if (kind === 'accept') return 'Quote Accepted'
  if (kind === 'decline') return 'Quote Declined'
  if (kind === 'consultation') return 'Consultation'
  return kind.replace(/_/g, ' ')
}

function eventTone(item: TimelineItem) {
  const kind = item.kind.toLowerCase()
  const text = item.text.toLowerCase()

  if (kind.includes('consultation')) {
    return {
      dot: 'border-emerald-300 text-emerald-700 bg-emerald-50',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      panel: 'border-emerald-200 bg-emerald-50/40',
      accent: 'text-emerald-700',
    }
  }
  if (kind.includes('sms')) {
    return {
      dot: 'border-sky-300 text-sky-700 bg-sky-50',
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
      panel: 'border-sky-200 bg-sky-50/30',
      accent: 'text-sky-700',
    }
  }
  if (kind.includes('email')) {
    return {
      dot: 'border-violet-300 text-violet-700 bg-violet-50',
      badge: 'bg-violet-50 text-violet-700 border-violet-200',
      panel: 'border-violet-200 bg-violet-50/30',
      accent: 'text-violet-700',
    }
  }
  if (kind.includes('quote')) {
    return {
      dot: 'border-amber-300 text-amber-700 bg-amber-50',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      panel: 'border-amber-200 bg-amber-50/30',
      accent: 'text-amber-700',
    }
  }
  if (kind.includes('call')) {
    const inbound = text.includes('inbound')
    return inbound
      ? {
          dot: 'border-emerald-300 text-emerald-700 bg-emerald-50',
          badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          panel: 'border-emerald-200 bg-emerald-50/30',
          accent: 'text-emerald-700',
        }
      : {
          dot: 'border-rose-300 text-rose-700 bg-rose-50',
          badge: 'bg-rose-50 text-rose-700 border-rose-200',
          panel: 'border-rose-200 bg-rose-50/30',
          accent: 'text-rose-700',
        }
  }
  return {
    dot: 'border-[rgba(228,226,220,1)] text-[var(--app-muted)] bg-white',
    badge: 'bg-stone-50 text-stone-600 border-stone-200',
    panel: 'border-[var(--app-line)] bg-[var(--app-panel)]',
    accent: 'text-stone-700',
  }
}

type Props = {
  item: TimelineItem
  expandedByDefault?: boolean
  quote: CRMQuote | null
  inventoryCubicFeet: number
  onOpenQuoteBuilder: () => void
}

export function TimelineEventCard({ item, expandedByDefault = false, quote, inventoryCubicFeet, onOpenQuoteBuilder }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault)
  const tone = eventTone(item)
  const previewText = item.aiSummary?.summary || item.transcript || item.text
  const hasDetails = !!(item.recordingUrl || item.transcript || item.aiSummary || (quote && item.id === `quote-created-${quote.id}`))

  return (
    <div className="relative pl-12">
      <div className={`absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold uppercase tracking-[0.12em] ${tone.dot}`}>
        {item.kind.slice(0, 1)}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-ink)]">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${tone.badge}`}>
              {kindLabel(item.kind)}
            </span>
            {item.duration ? <span className="text-xs text-[var(--app-muted)]">· {item.duration}</span> : null}
            {item.phone ? <span className="text-xs text-[var(--app-muted)]">· {item.phone}</span> : null}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-[var(--app-muted)]">{formatDateTime(item.date)}</div>
            {hasDetails ? (
              <button
                type="button"
                onClick={() => setExpanded(current => !current)}
                className="rounded-full border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]"
              >
                {expanded ? 'Hide' : 'Open'}
              </button>
            ) : null}
          </div>
        </div>
        <div className={`rounded-[8px] border p-4 ${tone.panel}`}>
          <div className="text-sm leading-6 text-[var(--app-ink)]">{expanded ? item.text : previewText}</div>

          {expanded && (item.recordingUrl || item.transcript || item.aiSummary) ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="crm-label">{item.kind === 'consultation' ? 'Consultation Intelligence' : 'Call Intelligence'}</div>
                  {item.duration ? <div className={`text-xs font-medium ${tone.accent}`}>{item.duration}</div> : null}
                </div>
                <div className="mt-2 text-sm leading-6 text-stone-800">
                  {item.aiSummary?.summary || item.transcript || 'No transcript or summary attached yet.'}
                </div>
                {item.recordingUrl ? (
                  <div className="mt-4 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--app-muted)]">
                      <span>Recording</span>
                      <span>{item.phone || 'Attached audio'}</span>
                    </div>
                    <audio controls className="w-full" src={item.recordingUrl}>
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                ) : null}
                {item.transcript ? (
                  <details className="mt-3 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                      Transcript
                    </summary>
                    <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-stone-700">
                      {item.transcript}
                    </div>
                  </details>
                ) : null}
              </div>
              <div className="space-y-3">
                {item.aiSummary?.leadConcern ? (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4">
                    <div className="crm-label">Concern</div>
                    <div className="mt-2 text-sm leading-6 text-stone-800">{item.aiSummary.leadConcern}</div>
                  </div>
                ) : null}
                {item.aiSummary?.decisionMaker ? (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4">
                    <div className="crm-label">Decision Maker</div>
                    <div className="mt-2 text-sm leading-6 text-stone-800">{item.aiSummary.decisionMaker}</div>
                  </div>
                ) : null}
                {item.aiSummary?.nextAction ? (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4">
                    <div className="crm-label">Next Action</div>
                    <div className="mt-2 text-sm leading-6 text-stone-800">{item.aiSummary.nextAction}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {expanded && quote && item.id === `quote-created-${quote.id}` ? (
            <div className="mt-4 flex items-center justify-between rounded-[8px] border border-[var(--app-line)] bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded bg-[var(--app-bg)] text-sm">▣</div>
                <div>
                  <div className="text-sm font-medium text-[var(--app-ink)]">Initial Quote</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">{formatMoney(quote.total)} · {inventoryCubicFeet} cu ft</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-[rgba(194,122,78,0.10)] px-2 py-1 text-xs font-medium text-[var(--app-warm)]">
                  {quote.status === 'accepted' ? 'Signed' : quote.status === 'sent' ? 'Pending Review' : quote.status}
                </div>
                <button onClick={onOpenQuoteBuilder} className="inline-flex rounded-[4px] bg-[var(--app-ink)] px-4 py-2 text-sm font-medium text-white">
                  Open Quote
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
