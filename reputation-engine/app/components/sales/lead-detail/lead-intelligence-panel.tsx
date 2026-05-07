'use client'

import { useEffect, useRef, useState } from 'react'
import type { CRMLead, LeadIntelligence, LeadIntelligenceFollowUp, SalesLeadStage } from '@/lib/types'

interface Props {
  lead: CRMLead
  onLeadUpdate: (lead: CRMLead) => void
  onApplyFollowUp?: (date: string, note: string) => void
  onApplyStage?: (stage: SalesLeadStage) => void
}

function TemperatureBadge({ value }: { value: LeadIntelligence['temperature'] }) {
  if (value === 'hot') return <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">🔥 Hot</span>
  if (value === 'warm') return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">⚡ Warm</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">❄ Cold</span>
}

function TrendBadge({ value }: { value: LeadIntelligence['sentimentTrend'] }) {
  if (value === 'improving') return <span className="text-[10px] font-medium text-emerald-600">↑ improving</span>
  if (value === 'declining') return <span className="text-[10px] font-medium text-rose-500">↓ declining</span>
  return <span className="text-[10px] font-medium text-slate-400">→ stable</span>
}

function ProbabilityBar({ value }: { value: number }) {
  const color = value >= 70 ? '#16a34a' : value >= 40 ? '#f5a623' : '#94a3b8'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{value}%</span>
    </div>
  )
}

function FollowUpItem({
  item,
  lead,
  repName,
  onSent,
}: {
  item: LeadIntelligenceFollowUp
  lead: CRMLead
  repName?: string
  onSent: () => void
}) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(
    item.script.replace(/\[Your Name\]/g, repName || 'Your Name').replace(/\[Name\]/g, lead.name?.split(' ')[0] || 'there')
  )

  async function send() {
    if (!lead.phone) return
    setSending(true)
    try {
      const res = await fetch('/api/sales/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channel: item.channel === 'email' ? 'email' : 'sms',
          to: item.channel === 'email' ? lead.email : lead.phone,
          body,
          leadId: lead.id,
          notes: `AI-suggested follow-up (${item.isCloseAttempt ? 'close attempt' : 'follow-up'})`,
          actor: 'human',
        }),
      })
      if (!res.ok) throw new Error('Send failed')
      setSent(true)
      onSent()
    } catch {
      // silent — UI stays in send state for retry
    } finally {
      setSending(false)
    }
  }

  const [copied, setCopied] = useState(false)

  function copyTalkingPoints() {
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const channelIcon = item.channel === 'call' ? '📞' : item.channel === 'email' ? '✉️' : '💬'
  const dueLabel = new Date(item.dueDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
  const isCall = item.channel === 'call'

  return (
    <div className={`rounded-[8px] border px-3 py-2.5 space-y-2 ${item.isCloseAttempt ? 'border-emerald-200 bg-emerald-50' : 'border-[var(--app-line)] bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px]">{channelIcon}</span>
          <span className="text-[11px] font-semibold text-[var(--app-ink)]">{dueLabel}</span>
          {item.isCloseAttempt && (
            <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">CLOSE</span>
          )}
        </div>
        {sent ? (
          <span className="text-[10px] font-semibold text-emerald-600">Sent ✓</span>
        ) : (
          <button
            onClick={() => setEditing(v => !v)}
            className="text-[10px] font-medium text-[var(--app-muted)] underline underline-offset-2 hover:text-[var(--app-ink)]"
          >
            {editing ? 'collapse' : isCall ? 'view script' : 'edit & send'}
          </button>
        )}
      </div>

      {/* Script — always expandable, call items show talking points + copy */}
      {editing ? (
        <div className="space-y-2">
          {isCall && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Call talking points
            </div>
          )}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-2 text-[11px] text-[var(--app-ink)] outline-none focus:border-[#1a2744]"
          />
          {isCall ? (
            <button
              onClick={copyTalkingPoints}
              className="w-full rounded-[6px] border border-[var(--app-line)] bg-white py-1.5 text-[11px] font-semibold text-[var(--app-ink)] hover:bg-[var(--app-bg)] transition-colors"
            >
              {copied ? '✓ Copied' : '📋 Copy talking points'}
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={sending || !body.trim()}
              className="w-full rounded-[6px] bg-[#1a2744] py-1.5 text-[11px] font-semibold text-white hover:bg-[#243459] disabled:opacity-50 transition-colors"
            >
              {sending ? 'Sending…' : `Send ${item.channel === 'sms' ? 'SMS' : 'Email'}`}
            </button>
          )}
        </div>
      ) : (
        <div className="text-[10px] leading-snug text-[var(--app-muted)] italic">
          "{body.length > 100 ? body.slice(0, 100) + '…' : body}"
        </div>
      )}

      {/* Quick-send for SMS/email (not calls) */}
      {!editing && !sent && !isCall && (lead.phone || lead.email) && (
        <button
          onClick={() => void send()}
          disabled={sending}
          className={`w-full rounded-[6px] py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
            item.isCloseAttempt
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'border border-[var(--app-line)] bg-white text-[var(--app-ink)] hover:bg-[var(--app-bg)]'
          }`}
        >
          {sending ? 'Sending…' : `Send ${item.channel === 'sms' ? 'SMS' : 'Email'} now`}
        </button>
      )}
    </div>
  )
}

export function LeadIntelligencePanel({ lead, onLeadUpdate, onApplyFollowUp, onApplyStage }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [settingTentative, setSettingTentative] = useState(false)
  const autoRunRef = useRef(false)

  const intel = lead.intelligence

  async function runAnalysis() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/intelligence`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json() as { intelligence?: LeadIntelligence; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Analysis failed')
      onLeadUpdate({ ...lead, intelligence: data.intelligence })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function setTentativeReservation() {
    setSettingTentative(true)
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      const followUpNote = intel?.followUpNote || 'Follow up on tentative reservation — close attempt'

      const res = await fetch(`/api/sales/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stage: 'tentative',
          followUpDate: intel?.followUpAt ? intel.followUpAt.slice(0, 10) : tomorrow,
          followUpNote,
        }),
      })
      const data = await res.json() as (CRMLead & { error?: string })
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to set tentative reservation')
      onLeadUpdate(data)
      if (onApplyFollowUp) onApplyFollowUp(data.followUpDate || tomorrow, followUpNote)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSettingTentative(false)
    }
  }

  function applyFollowUp() {
    if (!intel?.followUpAt || !onApplyFollowUp) return
    onApplyFollowUp(intel.followUpAt.slice(0, 10), intel.followUpNote || intel.nextAction)
  }

  function applyStage() {
    if (!intel?.stageSuggestion || !onApplyStage) return
    onApplyStage(intel.stageSuggestion)
  }

  const isTentative = lead.stage === 'tentative'
  const shouldAutoAnalyze =
    !intel ||
    (!!lead.lastInboundAt && (!intel.lastAnalyzedAt || new Date(lead.lastInboundAt).getTime() > new Date(intel.lastAnalyzedAt).getTime())) ||
    (!!lead.lastMissedCallAt && (!intel.lastAnalyzedAt || new Date(lead.lastMissedCallAt).getTime() > new Date(intel.lastAnalyzedAt).getTime())) ||
    (!!lead.lastVoicemailAt && (!intel.lastAnalyzedAt || new Date(lead.lastVoicemailAt).getTime() > new Date(intel.lastAnalyzedAt).getTime()))

  useEffect(() => {
    if (!shouldAutoAnalyze || busy || autoRunRef.current) return
    autoRunRef.current = true
    void runAnalysis()
  }, [busy, shouldAutoAnalyze])

  useEffect(() => {
    autoRunRef.current = false
  }, [lead.id])

  return (
    <div className="border-b border-[var(--app-line)]">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[var(--app-bg)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--app-ink)]">Sales Assist</span>
          {intel && <TemperatureBadge value={intel.temperature} />}
          {isTentative && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">Tentative</span>
          )}
        </div>
        <span className="text-[10px] text-[var(--app-muted)]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4">

          {/* Tentative Reservation quick action — always visible, prominent */}
          {!isTentative && (
            <button
              onClick={() => void setTentativeReservation()}
              disabled={settingTentative}
              className="w-full rounded-[8px] border-2 border-orange-300 bg-orange-50 py-2.5 text-[12px] font-semibold text-orange-800 hover:bg-orange-100 disabled:opacity-60 transition-colors"
            >
              {settingTentative ? 'Setting…' : '📅 Set Tentative Reservation'}
            </button>
          )}
          {isTentative && (
            <div className="rounded-[8px] border-2 border-orange-300 bg-orange-50 px-3 py-2.5">
              <div className="text-[12px] font-semibold text-orange-800">📅 Tentative Reservation Active</div>
              <div className="mt-0.5 text-[11px] text-orange-700">
                {lead.followUpDate
                  ? `Follow-up: ${new Date(lead.followUpDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}`
                  : 'No follow-up date set'}
                {lead.followUpNote ? ` — ${lead.followUpNote}` : ''}
              </div>
              <div className="mt-1.5 text-[10px] text-orange-600">Next call is a close attempt. Use the Tentative to Firm tactic.</div>
            </div>
          )}

          {!intel ? (
            <div className="rounded-[10px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-center">
              <div className="text-2xl">{busy ? '⋯' : '🧭'}</div>
              <div className="mt-1.5 text-[12px] font-medium text-[var(--app-ink)]">{busy ? 'Building Sales Assist…' : 'Sales Assist will populate automatically'}</div>
              <div className="mt-1 text-[11px] text-[var(--app-muted)]">Inbound calls, SMS, emails, quote views, and stage changes now trigger analysis in the background.</div>
            </div>
          ) : (
            <>
              {intel.personaBadges && intel.personaBadges.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Persona Badges</div>
                  <div className="flex flex-wrap gap-2">
                    {intel.personaBadges.slice(0, 3).map(badge => (
                      <div key={badge.label} className="rounded-[8px] border border-sky-200 bg-sky-50 px-3 py-2">
                        <div className="text-[11px] font-semibold text-sky-800">{badge.label} · {badge.confidence}%</div>
                        <div className="mt-0.5 text-[10px] leading-snug text-sky-700">{badge.explanation}</div>
                        <div className="mt-1 text-[10px] text-sky-600">{badge.source}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {intel.suggestedSalesLanguage && (
                <div className="rounded-[8px] border border-[#1a2744]/15 bg-[#1a2744]/5 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#1a2744]/60">How To Approach This Lead</div>
                  <div className="mt-1 text-[11px] leading-[1.6] text-[#1a2744]/80">{intel.suggestedSalesLanguage}</div>
                </div>
              )}

              {/* Booking probability */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--app-muted)]">Booking probability</span>
                  <TrendBadge value={intel.sentimentTrend} />
                </div>
                <ProbabilityBar value={intel.bookingProbability} />
              </div>

              {/* Next action */}
              <div className="rounded-[8px] bg-[#1a2744]/5 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#1a2744]/60">Next action</div>
                <div className="mt-0.5 text-[13px] font-semibold text-[#1a2744]">{intel.nextAction}</div>
                {intel.nextActionDetail && (
                  <div className="mt-1 text-[11px] leading-[1.5] text-[#1a2744]/70">{intel.nextActionDetail}</div>
                )}
              </div>

              {/* Authority takeover flag */}
              {intel.authorityTakeoverFlag && (
                <div className="rounded-[8px] border border-rose-300 bg-rose-50 px-3 py-2">
                  <div className="text-[11px] font-semibold text-rose-700">⚡ Flag for John — Authority Takeover</div>
                  <div className="mt-0.5 text-[10px] leading-snug text-rose-600">Deal is stuck. Loop in John for a manager callback to close.</div>
                </div>
              )}

              {/* Follow-up suggestion */}
              {intel.followUpAt && (
                <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2">
                  <span className="mt-0.5 text-[13px]">📅</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-amber-800">
                      {new Date(intel.followUpAt).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    {intel.followUpNote && (
                      <div className="mt-0.5 text-[11px] text-amber-700 leading-snug">{intel.followUpNote}</div>
                    )}
                  </div>
                  {onApplyFollowUp && (
                    <button
                      onClick={applyFollowUp}
                      className="shrink-0 rounded-[6px] bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700 transition-colors"
                    >
                      Apply
                    </button>
                  )}
                </div>
              )}

              {/* Stage suggestion */}
              {intel.stageSuggestion && intel.stageSuggestion !== lead.stage && (
                <div className="flex items-start gap-2 rounded-[8px] border border-violet-200 bg-violet-50 px-3 py-2">
                  <span className="mt-0.5 text-[13px]">🔄</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-violet-800">
                      Move to <span className="capitalize">{intel.stageSuggestion.replace(/_/g, ' ')}</span>
                    </div>
                    {intel.stageSuggestionReason && (
                      <div className="mt-0.5 text-[11px] text-violet-700 leading-snug">{intel.stageSuggestionReason}</div>
                    )}
                  </div>
                  {onApplyStage && (
                    <button
                      onClick={applyStage}
                      className="shrink-0 rounded-[6px] bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-violet-700 transition-colors"
                    >
                      Apply
                    </button>
                  )}
                </div>
              )}

              {/* Key insights */}
              {intel.keyInsights.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Key Insights</div>
                  <ul className="space-y-1">
                    {intel.keyInsights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--app-ink)] leading-snug">
                        <span className="mt-0.5 shrink-0 text-[#f5a623]">◆</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Concerns */}
              {intel.detectedConcerns.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Objections / Concerns</div>
                  <ul className="space-y-1">
                    {intel.detectedConcerns.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-rose-700 leading-snug">
                        <span className="mt-0.5 shrink-0">⚠</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Win factors */}
              {intel.winFactors.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Buying Signals</div>
                  <ul className="space-y-1">
                    {intel.winFactors.map((w, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-700 leading-snug">
                        <span className="mt-0.5 shrink-0">✓</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Coaching note */}
              {intel.coachingNote && (
                <div className="rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Rep coaching</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-blue-800">{intel.coachingNote}</div>
                </div>
              )}

              {/* Suggested tactic */}
              {intel.suggestedTactic && (
                <div className="rounded-[8px] border border-indigo-200 bg-indigo-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Closing tactic</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-indigo-800">{intel.suggestedTactic}</div>
                </div>
              )}

              {/* Process gaps */}
              {intel.processGaps.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Process gaps</div>
                  <ul className="space-y-1">
                    {intel.processGaps.map((gap, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-orange-700 leading-snug">
                        <span className="mt-0.5 shrink-0">○</span>
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Follow-up schedule with one-click send */}
              {intel.followUpSchedule.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Follow-up schedule</div>
                  <div className="space-y-2">
                    {intel.followUpSchedule.map((f, i) => (
                      <FollowUpItem
                        key={i}
                        item={f}
                        lead={lead}
                        onSent={() => {}}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="pt-1">
                <span className="text-[10px] text-[var(--app-muted)]">
                  {intel.signalSummary} · {new Date(intel.lastAnalyzedAt).toLocaleDateString('en-CA')}
                </span>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-[8px] bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>
          )}

          <button
            onClick={() => void runAnalysis()}
            disabled={busy}
            className="w-full rounded-[8px] border border-[var(--app-line)] bg-white py-2 text-[11px] font-semibold text-[var(--app-ink)] hover:bg-[var(--app-bg)] disabled:opacity-60 transition-colors"
          >
            {busy ? 'Refreshing Sales Assist…' : 'Refresh Sales Assist'}
          </button>
        </div>
      )}
    </div>
  )
}
