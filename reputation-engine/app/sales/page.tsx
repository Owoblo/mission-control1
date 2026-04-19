'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { dateStamp, formatDate, formatMoney } from '@/lib/sales'
import { fetchSalesOverview, updateSalesLead } from '@/lib/sales-api'
import type { CRMLead, CRMQuote, FollowUpLog, SalesDashboardSummary } from '@/lib/types'

type LiveFeedEvent = {
  text: string
  date: string
  tone: 'accepted' | 'viewed' | 'new' | 'neutral'
}

function buildLiveFeedEvents(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]): LiveFeedEvent[] {
  const events: LiveFeedEvent[] = []
  ;(lead.callLogs || []).forEach(item => {
    const isInbound = item.source === 'inbound' || (item.notes || '').toLowerCase().includes('inbound call')
    const label = item.isVoicemail
      ? `Voicemail${isInbound ? ' (inbound)' : ''} dropped`
      : item.aiSummary?.summary
        || (isInbound ? `Inbound call${item.notes?.includes('Recording processing') ? ' — recording processing' : ''}` : item.notes)
        || 'Call logged'
    events.push({ text: label, date: item.date, tone: 'neutral' })
  })
  // Include follow-up logs (SMS, email, notes) for this lead
  ;(followUps || []).filter(f => f.leadId === lead.id && f.type !== 'note').forEach(f => {
    const prefix = f.type === 'sms' ? 'SMS sent' : f.type === 'email' ? 'Email sent' : f.type
    const preview = f.notes ? ` — "${f.notes.slice(0, 60)}${f.notes.length > 60 ? '…' : ''}"` : ''
    events.push({ text: `${prefix}${preview}`, date: f.date || f.createdAt, tone: 'neutral' })
  })
  if (quote?.status === 'declined') events.push({ text: `${quote.number} declined.`, date: quote.respondedAt || quote.createdAt, tone: 'neutral' })
  if (quote?.acceptedAt) events.push({ text: `${quote.number} accepted.`, date: quote.acceptedAt, tone: 'accepted' })
  if (quote?.viewedAt) events.push({ text: `${quote.number} viewed.`, date: quote.viewedAt, tone: 'viewed' })
  if (quote?.sentAt) events.push({ text: `${quote.number} sent.`, date: quote.sentAt, tone: 'neutral' })
  if (events.length === 0) {
    events.push({ text: 'Lead created.', date: lead.createdAt, tone: lead.stage === 'new' ? 'new' : 'neutral' })
  }
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return events
}

function latestTimelineText(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]) {
  return buildLiveFeedEvents(lead, quote, followUps)[0]?.text || 'Lead created.'
}

function latestActivityDate(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]) {
  return buildLiveFeedEvents(lead, quote, followUps)[0]?.date || lead.createdAt
}

export default function SalesDashboardPage() {
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [summary, setSummary] = useState<SalesDashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setQuotes(data.quotes)
      setFollowUps(data.followUps)
      setSummary(data.summary)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Silent background refresh every 30s
    const interval = setInterval(() => {
      fetchSalesOverview()
        .then(data => {
          setLeads(data.leads)
          setQuotes(data.quotes)
          setFollowUps(data.followUps)
          setSummary(data.summary)
        })
        .catch(() => {/* silently ignore — stale data is fine */})
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  async function dismissTask(lead: CRMLead) {
    setDismissed(prev => new Set(Array.from(prev).concat(lead.id)))
    try {
      await updateSalesLead(lead.id, { followUpDate: undefined })
    } catch {
      setDismissed(prev => { const next = new Set(prev); next.delete(lead.id); return next })
    }
  }

  const quoteMap = useMemo(() => new Map(quotes.map(item => [item.id, item])), [quotes])
  const today = dateStamp()
  const quotesSentToday = useMemo(
    () => quotes.filter(item => item.sentAt && item.sentAt.slice(0, 10) === today).length,
    [quotes, today]
  )
  const followUpFocus = useMemo(() => {
    return leads
      .filter(lead => !dismissed.has(lead.id) && lead.followUpDate && lead.followUpDate <= today && !['booked', 'lost'].includes(lead.stage))
      .sort((a, b) => (a.followUpDate || '').localeCompare(b.followUpDate || ''))
      .slice(0, 5)
  }, [leads, dismissed, today])

  const expiringQuotes = useMemo(() => {
    return quotes
      .filter(q => (q.status === 'sent' || q.status === 'viewed') && daysUntilExpiry(q) !== null && (daysUntilExpiry(q) as number) <= 7)
      .sort((a, b) => (daysUntilExpiry(a) ?? 99) - (daysUntilExpiry(b) ?? 99))
      .slice(0, 5)
  }, [quotes])

  const liveFeed = useMemo(() => {
    return leads
      .slice()
      .sort((a, b) => {
        const quoteA = a.quoteId ? quoteMap.get(a.quoteId) : undefined
        const quoteB = b.quoteId ? quoteMap.get(b.quoteId) : undefined
        const aDate = buildLiveFeedEvents(a, quoteA, followUps)[0]?.date || a.createdAt
        const bDate = buildLiveFeedEvents(b, quoteB, followUps)[0]?.date || b.createdAt
        return new Date(bDate).getTime() - new Date(aDate).getTime()
      })
      .slice(0, 8)
      .map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
        const latestEvent = buildLiveFeedEvents(lead, quote, followUps)[0]
        return {
          id: lead.id,
          href: `/sales/leads/${lead.id}`,
          title: latestEvent?.text || 'Lead created.',
          subtitle: `${lead.name} · ${lead.originCity || 'Origin TBD'} to ${lead.destCity || 'Destination TBD'}`,
          date: latestEvent?.date || lead.createdAt,
          tone: latestEvent?.tone || 'neutral',
        }
      })
  }, [leads, quoteMap, followUps])

  return (
    <div className="crm-shell">
      <div className="space-y-10">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--app-ink)] md:text-[28px]">Sales Overview</h1>
            <div className="mt-2 text-sm text-[var(--app-muted)]">Live pipeline, urgent follow-ups, and recent customer activity.</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--app-accent)]" />
              Auto-refreshes every 60s
            </div>
            <button onClick={() => void refresh()} className="crm-button">Refresh now</button>
          </div>
        </section>

        {error ? <div className="rounded-[4px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-0 border border-[var(--app-line)] bg-[var(--app-panel)] md:grid-cols-4">
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Total Active Leads</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{summary?.totalLeads ?? 0}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{summary?.leadsDueToday ?? 0} due today</div>
          </div>
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Quotes Sent Today</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{quotesSentToday}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{quotes.filter(item => item.sentAt).length} total sent</div>
          </div>
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Booked Jobs</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{summary?.bookedLeads ?? 0}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{summary?.quotedLeads ?? 0} currently quoted</div>
          </div>
          <div className="p-5">
            <div className="crm-label">Projected Revenue</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{formatMoney(summary?.bookedRevenue ?? 0)}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{formatMoney(summary?.quotedPipelineValue ?? 0)} open pipeline</div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-[4px] border border-[rgba(228,226,220,1)] bg-white px-4 py-16 text-center text-sm text-[var(--app-muted)]">Loading dashboard...</div>
        ) : (
          <div className="grid grid-cols-12 gap-10">
            <section className="col-span-12 lg:col-span-8">
              <div className="mb-4 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                <h2 className="font-display text-[1.4rem] font-semibold tracking-tight text-[var(--app-ink)]">Live Feed</h2>
                <div className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
                  <span className="inline-block h-2 w-2 rounded-full bg-[var(--app-accent)]" />
                  Real-time sync
                </div>
              </div>
              <div className="relative ml-2 before:absolute before:bottom-0 before:left-[15px] before:top-0 before:w-px before:bg-[var(--app-line)]">
                {liveFeed.map(item => (
                  <Link key={item.id} href={item.href} className="relative -ml-2 block rounded-[4px] py-3 pl-10 transition hover:bg-[#f5f5f5]">
                    <div className="absolute left-[7px] top-4 flex h-[17px] w-[17px] items-center justify-center rounded-full border border-[var(--app-line)] bg-white">
                      <span className={`h-1.5 w-1.5 rounded-full ${item.tone === 'accepted' ? 'bg-[var(--app-accent)]' : item.tone === 'viewed' ? 'bg-[var(--app-warm)]' : item.tone === 'new' ? 'bg-[var(--app-warm)]' : 'bg-stone-300'}`} />
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-[var(--app-ink)]">{item.title}</div>
                        <div className="mt-1 text-sm text-[var(--app-muted)]">{item.subtitle}</div>
                      </div>
                      <div className="text-xs text-[var(--app-muted)]">{timeLabel(item.date)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="col-span-12 lg:col-span-4">
              <div className="mb-4 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                <h2 className="font-display text-[1.4rem] font-semibold tracking-tight text-[var(--app-ink)]">Urgent Tasks</h2>
                <span className="rounded-[4px] bg-[var(--app-wash)] px-2 py-0.5 text-xs text-[var(--app-muted)]">{followUpFocus.length} pending</span>
              </div>
              <div className="space-y-2">
                {followUpFocus.length === 0 ? (
                  <div className="rounded-[6px] border border-dashed border-[var(--app-line)] px-4 py-8 text-center text-sm text-[var(--app-muted)]">All caught up!</div>
                ) : followUpFocus.map(lead => (
                  <div key={lead.id} className="flex items-start gap-3 rounded-[6px] border border-transparent p-3 transition hover:border-[var(--app-line)] hover:bg-[var(--app-panel)]">
                    <button
                      type="button"
                      onClick={() => void dismissTask(lead)}
                      className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--app-line)] bg-white transition hover:border-emerald-500 hover:bg-emerald-50"
                      title="Mark done"
                    />
                    <Link href={`/sales/leads/${lead.id}`} className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--app-ink)]">{lead.followUpNote || latestTimelineText(lead, lead.quoteId ? quoteMap.get(lead.quoteId) : undefined, followUps)}</div>
                      <div className={`mt-1 text-xs ${lead.followUpDate && lead.followUpDate < today ? 'text-[var(--app-warm)]' : 'text-[var(--app-muted)]'}`}>
                        {lead.name} · {lead.followUpDate && lead.followUpDate < today ? 'Overdue' : 'Due today'}
                      </div>
                    </Link>
                  </div>
                ))}
              </div>

              {expiringQuotes.length > 0 ? (
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-[1.4rem] font-semibold tracking-tight text-[var(--app-ink)]">Expiring Quotes</h2>
                    <span className="rounded-[4px] bg-amber-50 px-2 py-0.5 text-xs text-amber-700 border border-amber-200">{expiringQuotes.length} at risk</span>
                  </div>
                  <div className="space-y-2">
                    {expiringQuotes.map(quote => {
                      const days = daysUntilExpiry(quote)
                      const lead = quote.leadId ? leads.find(l => l.id === quote.leadId) : undefined
                      return (
                        <Link key={quote.id} href={`/sales/quotes/${quote.id}`} className="flex items-start justify-between gap-3 rounded-[6px] border border-amber-100 bg-amber-50/50 p-3 transition hover:border-amber-200 hover:bg-amber-50">
                          <div>
                            <div className="text-sm font-medium text-[var(--app-ink)]">{quote.number}</div>
                            <div className="mt-0.5 text-xs text-[var(--app-muted)]">{lead?.name || 'Unknown'}</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-xs font-semibold ${days !== null && days <= 2 ? 'text-rose-600' : 'text-amber-700'}`}>
                              {days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : days !== null && days < 0 ? 'Expired' : `${days}d left`}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--app-muted)]">{formatMoney(quote.total)}</div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function daysUntilExpiry(quote: CRMQuote): number | null {
  if (!quote.createdAt) return null
  const base = new Date(`${quote.createdAt}T12:00:00`)
  base.setDate(base.getDate() + (quote.validDays || 30))
  const diff = base.getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function timeLabel(value: string) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  const timestamp = parsed.getTime()
  if (Number.isNaN(timestamp)) return '—'

  const diff = Date.now() - timestamp
  if (diff < 0) return formatDate(value)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return formatDate(value)
}
