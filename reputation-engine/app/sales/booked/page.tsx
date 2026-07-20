'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { sendSalesMessage, updateSalesLead } from '@/lib/sales-api'
import { dateStamp, formatDate, formatMoney, getLeadAssignedRepName, isBookedLikeStage } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { deriveJobReadiness } from '@/lib/job-spine'

const SATURN_PHONE = '226-773-2993'

function daysUntil(dateStr?: string) {
  if (!dateStr) return null
  const diff = new Date(`${dateStr}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function buildPreMoveEmail(lead: CRMLead) {
  const first = (lead.name || 'there').split(' ')[0]
  const dateLine = lead.moveDate
    ? new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'your move date'
  const route = lead.originCity && lead.destCity ? `${lead.originCity} → ${lead.destCity}` : lead.originCity || lead.destCity || ''

  return {
    subject: `Move day tomorrow — Saturn Star Moving`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#1a2744;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="color:#f5a623;font-size:22px;font-weight:700;">Saturn Star Moving</div>
    <div style="color:#ffffff80;font-size:13px;margin-top:4px;">Your Trusted Moving Partner</div>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:32px 24px;border-radius:0 0 12px 12px;">
    <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${first} — move day is tomorrow!</h1>
    <p style="color:#555;margin:0 0 20px;line-height:1.6;">Your crew is confirmed and we're ready to go. Here's a quick reminder:</p>
    <div style="background:#f8f9fb;border-radius:8px;padding:20px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#888;font-size:13px;">Move Date</span>
        <span style="font-weight:600;font-size:13px;">${dateLine}</span>
      </div>
      ${route ? `<div style="display:flex;justify-content:space-between;">
        <span style="color:#888;font-size:13px;">Route</span>
        <span style="font-weight:600;font-size:13px;">${route}</span>
      </div>` : ''}
    </div>
    <ul style="color:#374151;font-size:14px;line-height:2;padding-left:20px;margin:0 0 20px;">
      <li>Ensure clear vehicle access at both addresses</li>
      <li>Have any fragile or specialty items flagged for the crew</li>
      <li>Elevator reservations confirmed (if applicable)</li>
      <li>Any last-minute changes? Call us now</li>
    </ul>
    <div style="background:#1a2744;border-radius:8px;padding:16px;text-align:center;">
      <div style="color:#f5a623;font-weight:700;font-size:15px;">Questions? We're here.</div>
      <div style="color:#ffffffb0;font-size:13px;margin-top:4px;">${SATURN_PHONE} · business@starmovers.ca</div>
    </div>
  </div>
</div>`,
    text: `Hi ${first}, your Saturn Star move is TOMORROW (${dateLine}${route ? ` · ${route}` : ''}). Ensure clear access at both addresses. Any changes? Call us: ${SATURN_PHONE}`,
  }
}

function buildPreMoveSms(lead: CRMLead) {
  const first = (lead.name || 'there').split(' ')[0]
  const dateLine = lead.moveDate
    ? new Date(`${lead.moveDate}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
    : 'tomorrow'
  return `Hi ${first}! Your Saturn Star move is TOMORROW (${dateLine}). Make sure access is clear at both addresses. Any last-minute questions? Call or text ${SATURN_PHONE}. See you then! – Saturn Star Moving`
}

export default function BookedJobsPage() {
  const currentUser = useCurrentUser()
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reminderBusy, setReminderBusy] = useState<string | null>(null)
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set())
  const [windowDays, setWindowDays] = useState<30 | 60 | 90 | 999>(30)

  async function refresh() {
    try {
      setLoading(true)
      const response = await fetch('/api/sales/operations/jobs', { credentials: 'include', cache: 'no-store' })
      const data = await response.json() as { jobs?: Array<{ lead: CRMLead; quote: CRMQuote | null }>; error?: string }
      if (!response.ok || !data.jobs) throw new Error(data.error || 'Booked jobs could not be loaded')
      setLeads(data.jobs.map(job => job.lead))
      setQuotes(data.jobs.flatMap(job => job.quote ? [job.quote] : []))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const today = dateStamp()
  const quoteMap = useMemo(() => new Map(quotes.map(q => [q.id, q])), [quotes])
  const quoteByLead = useMemo(() => new Map(quotes.map(q => [q.leadId, q])), [quotes])

  const booked = useMemo(() => {
    const scopedLeads = currentUser?.role === 'sales_rep'
      ? leads.filter(lead => {
        if (currentUser.userId && lead.assignedRepUserId === currentUser.userId) return true
        return !!currentUser.name && getLeadAssignedRepName(lead) === currentUser.name
      })
      : leads

    return scopedLeads
      .filter(l => isBookedLikeStage(l.stage))
      .sort((a, b) => {
        const aQuote = quoteByLead.get(a.id) || (a.quoteId ? quoteMap.get(a.quoteId) : undefined)
        const bQuote = quoteByLead.get(b.id) || (b.quoteId ? quoteMap.get(b.quoteId) : undefined)
        const aOpsGaps = deriveJobReadiness(a, aQuote).total - deriveJobReadiness(a, aQuote).completed
        const bOpsGaps = deriveJobReadiness(b, bQuote).total - deriveJobReadiness(b, bQuote).completed
        if (aOpsGaps !== bOpsGaps) return bOpsGaps - aOpsGaps
        if (!a.moveDate && !b.moveDate) return 0
        if (!a.moveDate) return 1
        if (!b.moveDate) return -1
        return a.moveDate.localeCompare(b.moveDate)
      })
  }, [currentUser, leads, quoteByLead, quoteMap])

  const upcoming = booked.filter(l => {
    if (l.moveDate && l.moveDate < today) return false
    if (windowDays === 999 || !l.moveDate) return true
    const days = daysUntil(l.moveDate)
    return days === null || days <= windowDays
  })
  const past = booked.filter(l => l.moveDate && l.moveDate < today)

  async function sendReminder(lead: CRMLead) {
    if (!lead.phone && !lead.email) return
    try {
      setReminderBusy(lead.id)
      const email = buildPreMoveEmail(lead)
      const sms = buildPreMoveSms(lead)
      const sends: Promise<unknown>[] = []
      if (lead.phone) sends.push(sendSalesMessage({ channel: 'sms', to: lead.phone, body: sms, leadId: lead.id, notes: '48-hour pre-move reminder SMS sent.' }))
      if (lead.email) sends.push(sendSalesMessage({ channel: 'email', to: lead.email, subject: email.subject, body: email.text, htmlBody: email.html, leadId: lead.id, notes: '48-hour pre-move reminder email sent.' }))
      await Promise.all(sends)
      setReminderSent(prev => new Set(Array.from(prev).concat(lead.id)))

      // Log the reminder on the lead
      await updateSalesLead(lead.id, { notes: (lead.notes ? lead.notes + '\n' : '') + `48-hr reminder sent ${today}.` })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setReminderBusy(null)
    }
  }

  function dayLabel(days: number | null) {
    if (days === null) return 'Date TBD'
    if (days < 0) return `${Math.abs(days)}d ago`
    if (days === 0) return 'TODAY'
    if (days === 1) return 'TOMORROW'
    return `In ${days} days`
  }

  function urgencyClass(days: number | null) {
    if (days === null) return 'text-[var(--app-muted)]'
    if (days <= 0) return 'text-rose-700 font-bold'
    if (days === 1) return 'text-amber-700 font-bold'
    if (days <= 3) return 'text-amber-600 font-semibold'
    return 'text-[var(--app-accent)] font-medium'
  }

  return (
    <div className="crm-shell space-y-8">
      <section className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Booked Jobs</h1>
          <div className="mt-2 text-sm text-[var(--app-muted)]">
            {upcoming.length} upcoming · {past.length} completed{currentUser?.role === 'sales_rep' ? ' · your moves only' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={windowDays} onChange={event => setWindowDays(Number(event.target.value) as 30 | 60 | 90 | 999)} className="crm-input text-sm">
            <option value={30}>Next 30 days</option>
            <option value={60}>Next 60 days</option>
            <option value={90}>Next 90 days</option>
            <option value={999}>All upcoming</option>
          </select>
          <button onClick={() => void refresh()} className="crm-button">Refresh</button>
        </div>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading booked jobs...</div>
      ) : (
        <div className="space-y-8">
          {/* ── UPCOMING MOVES ── */}
          <section>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
              <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">Upcoming Moves</h2>
              <span className="text-xs text-[var(--app-muted)]">{upcoming.length} jobs</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                No upcoming moves booked yet.
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(lead => {
                  const quote = quoteByLead.get(lead.id) || (lead.quoteId ? quoteMap.get(lead.quoteId) : undefined)
                  const days = daysUntil(lead.moveDate)
                  const sent = reminderSent.has(lead.id)
                  const canRemind = !!(lead.phone || lead.email)
                  const readiness = deriveJobReadiness(lead, quote)
                  const assignedRep = getLeadAssignedRepName(lead) || 'Unassigned'
                  const needsOpsAttention = readiness.status !== 'fully_ready'
                  return (
                    <div
                      key={lead.id}
                      className={`rounded-[10px] border bg-[var(--app-panel)] p-5 ${needsOpsAttention ? 'border-rose-200 bg-rose-50/30' : days !== null && days <= 1 ? 'border-amber-200' : 'border-[var(--app-line)]'}`}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Link href={`/sales/leads/${lead.id}`} className="text-lg font-semibold text-[var(--app-ink)] hover:underline">
                              {lead.name}
                            </Link>
                            <span className={`text-sm ${urgencyClass(days)}`}>
                              {dayLabel(days)}
                            </span>
                            {lead.paymentStatus === 'deposit_received' ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Deposit ✓</span>
                            ) : (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">No Deposit</span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--app-muted)]">
                            <span>{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</span>
                            {lead.originCity || lead.destCity ? <span>{lead.originCity || 'Origin'} → {lead.destCity || 'Destination'}</span> : null}
                            {lead.moveType ? <span className="capitalize">{lead.moveType.replace(/-/g, ' ')}</span> : null}
                            {lead.phone ? <span>{lead.phone}</span> : null}
                            <span>Rep: {assignedRep}</span>
                          </div>
                          <div className="mt-3 flex items-center gap-3 text-xs"><span className={`font-semibold ${readiness.status === 'fully_ready' ? 'text-emerald-700' : readiness.status === 'at_risk' ? 'text-rose-700' : 'text-amber-700'}`}>{readiness.label} · {readiness.percent}%</span>{readiness.status !== 'fully_ready' && <span className="truncate text-[var(--app-muted)]">{readiness.dimensions.flatMap(item => item.missing).slice(0, 3).join(' · ')}</span>}</div>
                          {lead.contextFlag ? (
                            <div className="mt-2 text-xs text-amber-700">{lead.contextFlag}</div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-4 text-sm">
                            {quote ? (
                              <>
                                <span className="text-[var(--app-muted)]">Quote: <span className="font-semibold text-[var(--app-ink)]">{formatMoney(quote.total)}</span></span>
                                {lead.depositAmount ? (
                                  <span className="text-[var(--app-muted)]">Deposit: <span className="font-semibold text-[var(--app-accent)]">{formatMoney(lead.depositAmount)}</span></span>
                                ) : null}
                                <span className="text-[var(--app-muted)]">Balance: <span className="font-semibold text-[var(--app-ink)]">{formatMoney(quote.total - (lead.depositAmount || 0))}</span></span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end md:gap-2">
                          <Link href={`/sales/leads/${lead.id}`} className="crm-button text-sm">Open Lead</Link>
                          {canRemind ? (
                            <button
                              onClick={() => void sendReminder(lead)}
                              disabled={!!reminderBusy || sent}
                              className={`rounded-[8px] px-4 py-2 text-sm font-semibold transition ${
                                sent
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'bg-[var(--app-ink)] text-white hover:opacity-90 disabled:opacity-60'
                              }`}
                            >
                              {sent ? 'Reminder Sent ✓' : reminderBusy === lead.id ? 'Sending...' : '48-hr Reminder'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── PAST MOVES ── */}
          {past.length > 0 ? (
            <section>
              <div className="mb-4 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">Completed</h2>
                <span className="text-xs text-[var(--app-muted)]">{past.length} jobs</span>
              </div>
              <div className="space-y-2">
                {past.map(lead => {
                  const quote = quoteByLead.get(lead.id) || (lead.quoteId ? quoteMap.get(lead.quoteId) : undefined)
                  return (
                    <Link
                      key={lead.id}
                      href={`/sales/leads/${lead.id}`}
                      className="grid grid-cols-[minmax(0,1fr)_140px_140px] gap-4 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3 text-sm transition hover:bg-[var(--app-bg)]"
                    >
                      <div>
                        <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--app-muted)]">{lead.originCity || '?'} → {lead.destCity || '?'}</div>
                      </div>
                      <div className="text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : '—'}</div>
                      <div className="text-right font-medium text-[var(--app-ink)]">{quote ? formatMoney(quote.total) : '—'}</div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
