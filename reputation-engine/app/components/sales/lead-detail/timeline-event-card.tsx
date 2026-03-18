'use client'

import { useState } from 'react'
import { formatDateTime, formatMoney } from '@/lib/sales'
import { retranscribeConsultation } from '@/lib/sales-api'
import type { CRMQuote, CRMLead } from '@/lib/types'
import type { TimelineItem } from './timeline-types'

function kindLabel(kind: string) {
  if (kind === 'note') return 'Note'
  if (kind === 'sms') return 'SMS'
  if (kind === 'email') return 'Email'
  if (kind === 'view') return 'Quote Viewed'
  if (kind === 'accept') return 'Quote Accepted'
  if (kind === 'decline') return 'Quote Declined'
  if (kind === 'consultation') return 'Consultation'
  if (kind === 'status_change') return 'Stage Change'
  return kind.replace(/_/g, ' ')
}

function eventTone(item: TimelineItem) {
  const kind = item.kind.toLowerCase()
  const text = item.text.toLowerCase()

  if (kind === 'note') {
    return {
      dot: 'border-amber-300 text-amber-700 bg-amber-50',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      panel: 'border-amber-100 bg-amber-50/30',
      accent: 'text-amber-700',
    }
  }
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
  if (kind.includes('status_change')) {
    return {
      dot: 'border-slate-300 text-slate-600 bg-slate-50',
      badge: 'bg-slate-50 text-slate-600 border-slate-200',
      panel: 'border-slate-200 bg-slate-50/30',
      accent: 'text-slate-700',
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
  leadId?: string
  onLeadUpdate?: (lead: CRMLead) => void
}

export function TimelineEventCard({ item, expandedByDefault = false, quote, inventoryCubicFeet, onOpenQuoteBuilder, leadId, onLeadUpdate }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const tone = eventTone(item)

  const needsTranscription = item.kind === 'consultation' && !!item.recordingUrl && !item.transcript && !item.aiSummary

  async function handleRetranscribe() {
    if (!leadId || !item.id) return
    setTranscribing(true)
    setTranscribeError(null)
    try {
      const updated = await retranscribeConsultation(leadId, item.id)
      onLeadUpdate?.(updated)
    } catch (err) {
      setTranscribeError((err as Error).message || 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }
  const previewText = item.aiSummary?.summary || item.transcript || item.text
  const hasDetails = !!(item.recordingUrl || item.transcript || item.aiSummary || (quote && item.id === `quote-created-${quote.id}`))

  // ── SMS / Email bubble rendering ──
  const isMessage = item.kind === 'sms' || item.kind === 'email'
  const isOutbound = item.actor === 'rep' || item.actor === 'system'

  if (isMessage) {
    return (
      <div className={`flex flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-end gap-2 ${isOutbound ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* Avatar dot */}
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wide ${
            isOutbound
              ? 'bg-[var(--app-ink)] text-white'
              : 'bg-stone-200 text-stone-600'
          }`}>
            {isOutbound ? 'SS' : item.actor?.slice(0, 1).toUpperCase() || 'C'}
          </div>
          {/* Bubble */}
          <div className={`relative max-w-[75%] rounded-[18px] px-4 py-2.5 text-sm leading-[1.5] shadow-sm ${
            isOutbound
              ? item.kind === 'sms'
                ? 'rounded-br-[4px] bg-[var(--app-ink)] text-white'
                : 'rounded-br-[4px] bg-violet-700 text-white'
              : 'rounded-bl-[4px] bg-stone-100 text-stone-800'
          }`}>
            {item.text}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-9 text-[10px] text-[var(--app-muted)] ${isOutbound ? 'flex-row-reverse' : ''}`}>
          <span className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
            {item.kind === 'sms' ? 'SMS' : 'Email'}
          </span>
          <span>{formatDateTime(item.date)}</span>
          {isOutbound ? <span className="text-[var(--app-accent)]">Sent ✓</span> : <span className="text-stone-400">Received</span>}
        </div>
      </div>
    )
  }

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
            {item.isVoicemail ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">Voicemail</span>
            ) : null}
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
                  <div className="flex items-center gap-2">
                    <div className="crm-label">{item.kind === 'consultation' ? 'Consultation Intelligence' : 'Call Intelligence'}</div>
                    {item.aiSummary?.moveReadiness === 'hot' ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">🔥 Hot Lead</span>
                    ) : item.aiSummary?.moveReadiness === 'warm' ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">⚡ Warm</span>
                    ) : item.aiSummary?.moveReadiness === 'cold' ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">❄ Cold</span>
                    ) : null}
                  </div>
                  {item.duration ? <div className={`text-xs font-medium ${tone.accent}`}>{item.duration}</div> : null}
                </div>
                <div className="mt-2 text-sm leading-6 text-stone-800">
                  {item.aiSummary?.summary || item.transcript || (
                    needsTranscription ? (
                      <span className="text-amber-700">Recording saved — transcript not yet generated.</span>
                    ) : 'No transcript or summary attached yet.'
                  )}
                </div>
                {needsTranscription && (
                  <div className="mt-3">
                    {transcribeError && (
                      <div className="mb-2 text-xs text-rose-600">{transcribeError}</div>
                    )}
                    <button
                      onClick={() => void handleRetranscribe()}
                      disabled={transcribing}
                      className="rounded-[8px] bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {transcribing ? 'Transcribing...' : 'Transcribe Now'}
                    </button>
                  </div>
                )}
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
                {item.aiSummary?.coachingTip ? (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-[#1a2744] p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Rep Coaching</div>
                    <div className="mt-2 text-sm leading-6 text-white">{item.aiSummary.coachingTip}</div>
                  </div>
                ) : null}
                {item.aiSummary?.followUpReason ? (
                  <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4">
                    <div className="crm-label">Follow-up Timing</div>
                    <div className="mt-2 text-sm leading-6 text-stone-800">{item.aiSummary.followUpReason}</div>
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
