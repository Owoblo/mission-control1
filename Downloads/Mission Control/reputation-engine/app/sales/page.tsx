'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatDate, formatMoney } from '@/lib/sales'
import { fetchSalesOverview } from '@/lib/sales-api'
import type { CRMLead, CRMQuote, SalesDashboardSummary } from '@/lib/types'

function latestTimelineText(lead: CRMLead, quote?: CRMQuote) {
  const events: Array<{ text: string; date: string }> = []
  ;(lead.callLogs || []).forEach(item => {
    events.push({
      text: item.aiSummary?.summary || item.notes || item.type,
      date: item.date,
    })
  })
  if (quote?.status === 'declined') events.push({ text: `${quote.number} declined.`, date: quote.respondedAt || quote.createdAt })
  if (quote?.acceptedAt) events.push({ text: `${quote.number} accepted.`, date: quote.acceptedAt })
  if (quote?.viewedAt) events.push({ text: `${quote.number} viewed.`, date: quote.viewedAt })
  if (quote?.sentAt) events.push({ text: `${quote.number} sent.`, date: quote.sentAt })
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return events[0]?.text || 'No timeline activity yet.'
}

function stageTone(lead: CRMLead, quote?: CRMQuote) {
  if (lead.stage === 'new') return 'bg-[rgba(34,72,56,0.08)] text-[var(--app-accent)]'
  if (quote?.viewedAt) return 'bg-[rgba(194,122,78,0.10)] text-[var(--app-warm)]'
  if (lead.source?.includes('call')) return 'bg-[rgba(194,122,78,0.10)] text-[var(--app-warm)]'
  return 'bg-[var(--app-bg)] text-[var(--app-muted)]'
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
  const followUpFocus = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return leads
      .filter(lead => lead.followUpDate && lead.followUpDate <= today && !['booked', 'lost'].includes(lead.stage))
      .sort((a, b) => (a.followUpDate || '').localeCompare(b.followUpDate || ''))
      .slice(0, 5)
  }, [leads])

  const liveFeed = useMemo(() => {
    return leads
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6)
      .map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
        return {
          id: lead.id,
          href: `/sales/leads/${lead.id}`,
          title: latestTimelineText(lead, quote),
          subtitle: `${lead.name} · ${lead.originCity || 'Origin TBD'} to ${lead.destCity || 'Destination TBD'}`,
          date: lead.createdAt,
          tone: quote?.acceptedAt ? 'accepted' : quote?.viewedAt ? 'viewed' : lead.stage === 'new' ? 'new' : 'neutral',
        }
      })
  }, [leads, quoteMap])

  return (
    <div className="crm-shell">
      <div className="space-y-10">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--app-ink)] md:text-[28px]">Good morning, Alex.</h1>
            <div className="mt-2 text-sm text-[var(--app-muted)]">Here&apos;s what&apos;s happening with your moves today.</div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => void refresh()} className="crm-button">Refresh</button>
          </div>
        </section>

        {error ? <div className="rounded-[4px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-0 border border-[var(--app-line)] bg-[var(--app-panel)] md:grid-cols-4">
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Total Active Leads</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-5xl font-semibold leading-none text-[var(--app-ink)]">{summary?.totalLeads ?? 0}</div>
              <div className="pb-1 text-sm font-medium text-[var(--app-accent)]">+12%</div>
            </div>
          </div>
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Quotes Sent Today</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-5xl font-semibold leading-none text-[var(--app-ink)]">{quotes.filter(item => item.sentAt).length}</div>
              <div className="pb-1 text-sm font-medium text-[var(--app-accent)]">+5%</div>
            </div>
          </div>
          <div className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r">
            <div className="crm-label">Jobs Booked</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-5xl font-semibold leading-none text-[var(--app-ink)]">{quotes.filter(item => item.acceptedAt).length}</div>
              <div className="pb-1 text-sm font-medium text-[var(--app-muted)]">-2%</div>
            </div>
          </div>
          <div className="p-5">
            <div className="crm-label">Projected Revenue</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="text-5xl font-semibold leading-none text-[var(--app-ink)]">{formatMoney(summary?.bookedRevenue ?? 0)}</div>
              <div className="pb-1 text-sm font-medium text-[var(--app-accent)]">+18%</div>
            </div>
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
  const diff = Date.now() - new Date(value).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return formatDate(value)
}
