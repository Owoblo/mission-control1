'use client'

import { useState } from 'react'
import { RecordingPlayer } from '@/app/components/sales/recording-player'
import { formatDateTime, formatMoney } from '@/lib/sales'
import { retranscribeConsultation } from '@/lib/sales-api'
import type { CRMQuote, CRMLead } from '@/lib/types'
import type { TimelineItem } from './timeline-types'

function isIncidentText(text: string) {
  return text.startsWith('[INCIDENT')
}

function kindLabel(kind: string, text?: string) {
  if (kind === 'note' && text && isIncidentText(text)) return 'Incident'
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

function isFailedOrMissedCallText(text: string) {
  const normalized = text.toLowerCase()
  return (
    normalized.includes('failed') ||
    normalized.includes('no answer') ||
    normalized.includes('no-answer') ||
    normalized.includes('busy') ||
    normalized.includes('canceled') ||
    normalized.includes('cancelled') ||
    normalized.includes('missed')
  )
}

function eventTone(item: TimelineItem) {
  const kind = item.kind.toLowerCase()
  const text = item.text.toLowerCase()

  if (kind === 'note' && item.text && isIncidentText(item.text)) {
    return {
      dot: 'border-red-300 text-red-700 bg-red-50',
      badge: 'bg-red-50 text-red-700 border-red-200',
      panel: 'border-red-100 bg-red-50/30',
      accent: 'text-red-700',
    }
  }
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
  lead?: CRMLead
  onLeadUpdate?: (lead: CRMLead) => void
}

function buildVoicemailSms(lead?: CRMLead): string {
  const first = lead?.name?.split(' ')[0] || 'there'
  const moveMonth = lead?.moveDate ? new Date(lead.moveDate + 'T12:00:00').toLocaleString('en-CA', { month: 'long' }) : null
  const moveRef = moveMonth ? ` for your ${moveMonth} move` : ''
  return `Hey ${first} — just tried you and left a quick voicemail! Happy to lock in your estimate${moveRef}. Feel free to reply here or call us back at 226-773-2993. – John @ Saturn Star Movers ⭐`
}

function buildVoicemailEmail(lead?: CRMLead): { subject: string; body: string } {
  const first = lead?.name?.split(' ')[0] || 'there'
  const moveMonth = lead?.moveDate ? new Date(lead.moveDate + 'T12:00:00').toLocaleString('en-CA', { month: 'long' }) : null
  const moveRef = moveMonth ? ` for your ${moveMonth} move` : ''
  return {
    subject: `Quick note re: your upcoming move${moveMonth ? ' in ' + moveMonth : ''}`,
    body: `Hi ${first},\n\nJust left you a voicemail — wanted to follow up on your move${moveRef}. We'd love to put together a quick estimate for you.\n\nFeel free to reply to this email or give us a call at 226-773-2993 and we'll get everything sorted.\n\nLooking forward to helping!\n\nJohn\nSaturn Star Movers\n226-773-2993 | starmovers.ca`,
  }
}

export function TimelineEventCard({ item, expandedByDefault = false, quote, inventoryCubicFeet, onOpenQuoteBuilder, leadId, lead, onLeadUpdate }: Props) {
  const [expanded, setExpanded] = useState(expandedByDefault)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  // Post-voicemail follow-up state
  const [vmFollowUpMode, setVmFollowUpMode] = useState<'sms' | 'email' | 'both' | null>(null)
  const [vmSmsText, setVmSmsText] = useState(() => buildVoicemailSms(lead))
  const [vmEmailSubject, setVmEmailSubject] = useState(() => buildVoicemailEmail(lead).subject)
  const [vmEmailBody, setVmEmailBody] = useState(() => buildVoicemailEmail(lead).body)
  const [vmSending, setVmSending] = useState(false)
  const [vmSent, setVmSent] = useState<'sms' | 'email' | 'both' | null>(null)
  const tone = eventTone(item)

  const isCallKind = item.kind === 'call' || item.kind === 'consultation'
  // Show analyze button if there's a recording reference and no AI summary yet.
  const hasRecording = !!(item.recordingUrl || item.recordingSid)
  const recordingUnavailable = !!item.recordingUnavailable
  const failedOrMissedCall = isCallKind && !item.duration && isFailedOrMissedCallText(item.text)
  const needsTranscription = isCallKind && hasRecording && !item.aiSummary
  const [fetchingRec, setFetchingRec] = useState(false)
  const [fetchRecError, setFetchRecError] = useState<string | null>(null)

  async function sendOne(channel: 'sms' | 'email') {
    const body = channel === 'sms'
      ? { leadId, channel: 'sms', message: vmSmsText }
      : { leadId, channel: 'email', subject: vmEmailSubject, message: vmEmailBody }
    await fetch('/api/sales/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    })
  }

  async function refreshLead() {
    if (!leadId) return
    const res = await fetch(`/api/sales/leads/${leadId}`, { credentials: 'include' })
    if (res.ok) {
      const updated = await res.json() as CRMLead
      onLeadUpdate?.(updated)
    }
  }

  async function handleVmSend(channel: 'sms' | 'email' | 'both') {
    if (!leadId) return
    setVmSending(true)
    try {
      if (channel === 'both') {
        await Promise.all([sendOne('sms'), sendOne('email')])
      } else {
        await sendOne(channel)
      }
      setVmSent(channel)
      setVmFollowUpMode(null)
      // Refresh timeline so new SMS/email entries appear
      await refreshLead()
    } catch {
      // best-effort
    } finally {
      setVmSending(false)
    }
  }

  async function handleFetchRecording() {
    if (!leadId || (!item.callSid && !item.recordingSid)) return
    setFetchingRec(true)
    setFetchRecError(null)
    try {
      const res = await fetch('/api/sales/dialer/fetch-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSid: item.callSid, leadId, recordingSid: item.recordingSid }),
        credentials: 'include',
      })
      const data = await res.json() as {
        ok?: boolean
        error?: string
        recordingUrl?: string
        recordingUnavailable?: boolean
      }
      if (!res.ok || data.error) {
        if (data.recordingUnavailable) await refreshLead()
        throw new Error(data.error || 'Failed to fetch recording')
      }
      // Refresh the lead so the recording URL appears
      await refreshLead()
    } catch (err) {
      setFetchRecError((err as Error).message || 'Could not fetch recording')
    } finally {
      setFetchingRec(false)
    }
  }

  async function handleRetranscribe() {
    if (!leadId || !item.id) return
    setTranscribing(true)
    setTranscribeError(null)
    try {
      let updated: CRMLead
      if (item.kind === 'consultation' && item.recordingUrl?.startsWith('data:audio/')) {
        updated = await retranscribeConsultation(leadId, item.id)
      } else {
        const res = await fetch(`/api/sales/leads/${leadId}/reanalyze-call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callLogId: item.id }),
          credentials: 'include',
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as any).error || 'Reanalysis failed')
        }
        updated = await res.json() as CRMLead
      }
      onLeadUpdate?.(updated)
    } catch (err) {
      setTranscribeError((err as Error).message || 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }
  // ── SMS / Email bubble rendering ──
  const isMessage = item.kind === 'sms' || item.kind === 'email'
  const isOutbound = item.actor === 'rep' || item.actor === 'system'

  const previewText = (!isMessage && (item.aiSummary?.summary || item.transcript)) || item.text
  const hasDetails = !!(isCallKind || item.recordingUrl || item.transcript || item.aiSummary || (quote && item.id === `quote-created-${quote.id}`))

  if (isMessage) {
    const sentimentColor = item.aiSummary?.sentiment === 'positive' ? 'text-emerald-600' : item.aiSummary?.sentiment === 'negative' ? 'text-rose-500' : 'text-amber-500'
    return (
      <div className={`flex flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-end gap-2 ${isOutbound ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wide ${
            isOutbound ? 'bg-[#0b84ff] text-white' : 'bg-[#d1d1d6] text-[#3a3a3c]'
          }`}>
            {isOutbound ? 'SS' : item.actor?.slice(0, 1).toUpperCase() || 'C'}
          </div>
          <div className={`relative max-w-[75%] rounded-[18px] px-4 py-2.5 text-sm leading-[1.5] shadow-sm ${
            isOutbound
              ? item.kind === 'sms'
                ? 'rounded-br-[4px] bg-[#0b84ff] text-white'
                : 'rounded-br-[4px] bg-violet-600 text-white'
              : item.kind === 'sms'
                ? 'rounded-bl-[4px] bg-[#e9e9eb] text-[#1c1c1e]'
                : 'rounded-bl-[4px] bg-[#f0edf8] text-[#2c1f4a]'
          }`}>
            {!isOutbound && item.emailSubject && (
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] opacity-50">Re: {item.emailSubject}</div>
            )}
            {item.text}
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-9 text-[10px] text-[var(--app-muted)] ${isOutbound ? 'flex-row-reverse' : ''}`}>
          <span className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase tracking-[0.12em] ${tone.badge}`}>
            {item.kind === 'sms' ? 'SMS' : 'Email'}
          </span>
          <span>{formatDateTime(item.date)}</span>
          {isOutbound ? <span className="text-[#0b84ff]">Sent ✓</span> : <span className="text-stone-400">Received</span>}
          {item.aiSummary && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="rounded-full border border-[var(--app-line)] bg-white px-2 py-0.5 font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] hover:border-[var(--app-ink)]"
            >
              {expanded ? 'Hide AI' : '✦ AI'}
            </button>
          )}
        </div>
        {expanded && item.aiSummary && (
          <div className={`w-full max-w-[90%] rounded-[10px] border border-[var(--app-line)] bg-white p-4 ${isOutbound ? 'self-end' : 'self-start'}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Message Intelligence</span>
              {item.aiSummary.moveReadiness === 'hot' && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">🔥 Hot</span>}
              {item.aiSummary.moveReadiness === 'warm' && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">⚡ Warm</span>}
              {item.aiSummary.moveReadiness === 'cold' && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">❄ Cold</span>}
              {item.aiSummary.sentiment && (
                <span className={`text-[10px] font-semibold capitalize ${sentimentColor}`}>● {item.aiSummary.sentiment}</span>
              )}
            </div>
            <p className="text-sm leading-6 text-stone-800">{item.aiSummary.summary}</p>
            {item.aiSummary.intent && (
              <p className="mt-1 text-xs text-[var(--app-muted)]"><span className="font-semibold">Intent:</span> {item.aiSummary.intent}</p>
            )}
            {item.aiSummary.leadConcern && (
              <p className="mt-1 text-xs text-rose-600"><span className="font-semibold">Concern:</span> {item.aiSummary.leadConcern}</p>
            )}
            {item.aiSummary.nextAction && (
              <p className="mt-2 rounded-[6px] bg-[var(--app-bg)] px-3 py-2 text-xs font-medium text-[var(--app-ink)]">→ {item.aiSummary.nextAction}</p>
            )}
            {item.aiSummary.coachingTip && (
              <p className="mt-2 rounded-[6px] bg-[#1a2744] px-3 py-2 text-xs text-white"><span className="font-semibold opacity-60">Coach:</span> {item.aiSummary.coachingTip}</p>
            )}
          </div>
        )}
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
              {kindLabel(item.kind, item.text)}
            </span>
            {item.isVoicemail ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">Voicemail</span>
            ) : null}
            {item.branchLabel ? (
              <span className="rounded-full border border-[rgba(15,106,83,0.2)] bg-[rgba(15,106,83,0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-accent)]">
                {item.branchLabel}
              </span>
            ) : null}
            {item.duration ? <span className="text-xs text-[var(--app-muted)]">· {item.duration}</span> : null}
            {item.phone ? <span className="text-xs text-[var(--app-muted)]">· {item.phone}</span> : null}
            {item.repName && item.kind === 'call' ? (
              <span className="rounded-full border border-[#1a2744]/20 bg-[#1a2744]/8 px-2 py-0.5 text-[10px] font-semibold text-[#1a2744]">
                {item.repName}
              </span>
            ) : null}
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
        {/* Post-voicemail follow-up strip — always visible on voicemail cards */}
        {item.isVoicemail && (
          <div className="rounded-[8px] border border-[#1a2744]/20 bg-[#1a2744]/5 px-4 py-3">
            {vmSent ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#1a2744]">
                  <span className="text-emerald-600">✓</span>
                  <span>
                    {vmSent === 'both' ? 'SMS + Email sent' : vmSent === 'sms' ? 'Follow-up SMS sent' : 'Follow-up email sent'}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--app-muted)]">
                  {vmSent !== 'email' && lead?.phone && <span>SMS → {lead.phone}</span>}
                  {vmSent === 'both' && lead?.phone && lead?.email && <span> &nbsp;·&nbsp; </span>}
                  {vmSent !== 'sms' && lead?.email && <span>Email → {lead.email}</span>}
                </div>
                <button type="button" onClick={() => setVmSent(null)} className="text-[10px] text-[var(--app-muted)] underline">Send another</button>
              </div>
            ) : vmFollowUpMode === null ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]">Voicemail dropped</span>
                  <span className="text-[10px] text-[var(--app-muted)]">— follow up while you're top of mind</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleVmSend('both')}
                    disabled={vmSending}
                    className="rounded-[6px] bg-[#1a2744] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {vmSending ? 'Sending…' : '🚀 Send SMS + Email'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setVmSmsText(buildVoicemailSms(lead)); setVmFollowUpMode('sms') }}
                    className="rounded-[6px] border border-[#1a2744]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:bg-[#1a2744]/5"
                  >
                    💬 SMS only
                  </button>
                  <button
                    type="button"
                    onClick={() => { const e = buildVoicemailEmail(lead); setVmEmailSubject(e.subject); setVmEmailBody(e.body); setVmFollowUpMode('email') }}
                    className="rounded-[6px] border border-[#1a2744]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#1a2744] hover:bg-[#1a2744]/5"
                  >
                    📧 Email only
                  </button>
                </div>
                {(lead?.phone || lead?.email) && (
                  <div className="text-[10px] text-[var(--app-muted)]">
                    {lead?.phone && <span>SMS → {lead.phone}</span>}
                    {lead?.phone && lead?.email && <span> &nbsp;·&nbsp; </span>}
                    {lead?.email && <span>Email → {lead.email}</span>}
                  </div>
                )}
              </div>
            ) : vmFollowUpMode === 'sms' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]">Follow-Up SMS → {lead?.phone}</span>
                  <button type="button" onClick={() => setVmFollowUpMode(null)} className="text-xs text-[var(--app-muted)]">✕</button>
                </div>
                <textarea
                  value={vmSmsText}
                  onChange={e => setVmSmsText(e.target.value)}
                  rows={3}
                  className="w-full rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#1a2744]"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[var(--app-muted)]">{vmSmsText.length} chars</span>
                  <button
                    type="button"
                    onClick={() => void handleVmSend('sms')}
                    disabled={vmSending || !vmSmsText.trim()}
                    className="rounded-[6px] bg-[#1a2744] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {vmSending ? 'Sending…' : 'Send SMS'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a2744]">Follow-Up Email → {lead?.email}</span>
                  <button type="button" onClick={() => setVmFollowUpMode(null)} className="text-xs text-[var(--app-muted)]">✕</button>
                </div>
                <input
                  value={vmEmailSubject}
                  onChange={e => setVmEmailSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#1a2744]"
                />
                <textarea
                  value={vmEmailBody}
                  onChange={e => setVmEmailBody(e.target.value)}
                  rows={5}
                  className="w-full rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-[#1a2744]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleVmSend('email')}
                    disabled={vmSending || !vmEmailBody.trim()}
                    className="rounded-[6px] bg-[#1a2744] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {vmSending ? 'Sending…' : 'Send Email'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`rounded-[8px] border p-4 ${tone.panel}`}>
          <div className="text-sm leading-6 text-[var(--app-ink)]">{expanded ? item.text : previewText}</div>

          {expanded && isCallKind && recordingUnavailable && !hasRecording && !item.transcript && !item.aiSummary ? (
            <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3">
              <p className="text-xs text-[var(--app-muted)] italic">
                {item.recordingUnavailableReason || 'Twilio did not retain a playable recording for this call.'}
              </p>
            </div>
          ) : null}

          {expanded && failedOrMissedCall && !recordingUnavailable && !hasRecording && !item.transcript && !item.aiSummary ? (
            <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3">
              <p className="text-xs text-[var(--app-muted)] italic">
                This call did not connect, so Twilio did not create a recording.
              </p>
            </div>
          ) : null}

          {expanded && isCallKind && !failedOrMissedCall && !recordingUnavailable && !hasRecording && !item.transcript && !item.aiSummary && (
            <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3 space-y-2">
              <p className="text-xs text-[var(--app-muted)] italic">
                {item.callSid ? 'Recording not yet available — may still be processing.' : 'No recording for this call.'}
              </p>
              {item.callSid && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleFetchRecording()}
                    disabled={fetchingRec}
                    className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:bg-[var(--app-bg)] disabled:opacity-50"
                  >
                    {fetchingRec ? 'Fetching…' : 'Fetch Recording'}
                  </button>
                  {fetchRecError && <span className="text-xs text-rose-600">{fetchRecError}</span>}
                </div>
              )}
            </div>
          )}
          {expanded && (hasRecording || item.transcript || item.aiSummary) ? (
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
                      <span className="text-[var(--app-muted)] italic">Transcribing recording… check back in a moment.</span>
                    ) : 'No transcript available for this call.'
                  )}
                </div>
                {hasRecording ? (
                  <div className="mt-4 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--app-muted)]">
                      <span>Recording</span>
                      <span>{item.phone || 'Attached audio'}</span>
                    </div>
                    <RecordingPlayer recordingUrl={item.recordingUrl} recordingSid={item.recordingSid} />
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
