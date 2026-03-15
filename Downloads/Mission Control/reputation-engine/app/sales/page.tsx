'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatDate, formatMoney } from '@/lib/sales'
import { fetchSalesOverview } from '@/lib/sales-api'
import type { CRMLead, CRMQuote, SalesDashboardSummary } from '@/lib/types'

type LiveFeedEvent = {
  text: string
  date: string
  tone: 'accepted' | 'viewed' | 'new' | 'neutral'
}

function buildLiveFeedEvents(lead: CRMLead, quote?: CRMQuote): LiveFeedEvent[] {
  const events: LiveFeedEvent[] = []
  ;(lead.callLogs || []).forEach(item => {
    events.push({
      text: item.aiSummary?.summary || item.notes || item.type,
      date: item.date,
      tone: lead.stage === 'new' ? 'new' : lead.source?.includes('call') ? 'viewed' : 'neutral',
    })
  })
  if (quote?.status === 'declined') events.push({ text: `${quote.number} declined.`, date: quote.respondedAt || quote.createdAt, tone: 'neutral' })
  if (quote?.acceptedAt) events.push({ text: `${quote.number} accepted.`, date: quote.acceptedAt, tone: 'accepted' })
  if (quote?.viewedAt) events.push({ text: `${quote.number} viewed.`, date: quote.viewedAt, tone: 'viewed' })
  if (quote?.sentAt) events.push({ text: `${quote.number} sent.`, date: quote.sentAt, tone: 'neutral' })
  if (events.length === 0) {
    events.push({
      text: 'Lead created.',
      date: lead.createdAt,
      tone: lead.stage === 'new' ? 'new' : 'neutral',
    })
  }
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return events
}

function latestTimelineText(lead: CRMLead, quote?: CRMQuote) {
  return buildLiveFeedEvents(lead, quote)[0]?.text || 'Lead created.'
}

function latestActivityDate(lead: CRMLead, quote?: CRMQuote) {
  return buildLiveFeedEvents(lead, quote)[0]?.date || lead.createdAt
}

export default function SalesDashboardPage() {
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [summary, setSummary] = useState<SalesDashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setQuotes(data.quotes)
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
  }, [])

  const quoteMap = useMemo(() => new Map(quotes.map(item => [item.id, item])), [quotes])
  const today = new Date().toISOString().slice(0, 10)
  const quotesSentToday = useMemo(
    () => quotes.filter(item => item.sentAt && item.sentAt.slice(0, 10) === today).length,
    [quotes, today]
  )
  const followUpFocus = useMemo(() => {
    return leads
      .filter(lead => lead.followUpDate && lead.followUpDate <= today && !['booked', 'lost'].includes(lead.stage))
      .sort((a, b) => (a.followUpDate || '').localeCompare(b.followUpDate || ''))
      .slice(0, 5)
  }, [leads])

  const liveFeed = useMemo(() => {
    return leads
      .slice()
      .sort((a, b) => {
        const quoteA = a.quoteId ? quoteMap.get(a.quoteId) : undefined
        const quoteB = b.quoteId ? quoteMap.get(b.quoteId) : undefined
        return new Date(latestActivityDate(b, quoteB)).getTime() - new Date(latestActivityDate(a, quoteA)).getTime()
      })
      .slice(0, 6)
      .map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
        const latestEvent = buildLiveFeedEvents(lead, quote)[0]
        return {
          id: lead.id,
          href: `/sales/leads/${lead.id}`,
          title: latestEvent?.text || 'Lead created.',
          subtitle: `${lead.name} · ${lead.originCity || 'Origin TBD'} to ${lead.destCity || 'Destination TBD'}`,
          date: latestEvent?.date || lead.createdAt,
          tone: latestEvent?.tone || 'neutral',
        }
      })
  }, [leads, quoteMap])

  return (
    <div className="crm-shell">
      <div className="space-y-10">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--app-ink)] md:text-[28px]">Sales Overview</h1>
            <div className="mt-2 text-sm text-[var(--app-muted)]">Live pipeline, urgent follow-ups, and recent customer activity.</div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void refresh()} className="crm-button">Refresh</button>
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
                {followUpFocus.map(lead => (
                  <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="flex items-start gap-3 rounded-[6px] border border-transparent p-3 transition hover:border-[var(--app-line)] hover:bg-[var(--app-panel)]">
                    <input type="checkbox" readOnly className="mt-1 h-4 w-4 rounded border-[var(--app-line)]" />
                    <div>
                      <div className="text-sm text-[var(--app-ink)]">{lead.followUpNote || latestTimelineText(lead, lead.quoteId ? quoteMap.get(lead.quoteId) : undefined)}</div>
                      <div className={`mt-1 text-xs ${lead.followUpDate && lead.followUpDate < new Date().toISOString().slice(0, 10) ? 'text-[var(--app-warm)]' : 'text-[var(--app-muted)]'}`}>
                        {lead.followUpDate && lead.followUpDate < new Date().toISOString().slice(0, 10) ? 'Due now' : lead.followUpDate || 'Due today'}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
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
