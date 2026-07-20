'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { fetchSalesOverview } from '@/lib/sales-api'
import { dateStamp, formatDate, formatMoney, validUntil } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

function daysUntilExpiry(quote: CRMQuote): number | null {
  if (!quote.createdAt) return null
  const base = new Date(quote.createdAt.length === 10 ? `${quote.createdAt}T12:00:00` : quote.createdAt)
  if (Number.isNaN(base.getTime())) return null
  base.setDate(base.getDate() + (quote.validDays || 30))
  const diff = base.getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

export default function SalesQuotesIndexPage() {
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setQuotes(data.quotes)
      setLeads(data.leads)
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

  const leadMap = useMemo(() => new Map(leads.map(item => [item.id, item])), [leads])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setQuery((params.get('q') || '').trim().toLowerCase())
  }, [])

  const grouped = useMemo(() => {
    const groups: Record<string, CRMQuote[]> = {
      draft: [],
      sent: [],
      accepted: [],
      declined: [],
    }
    for (const quote of quotes) {
      const lead = quote.leadId ? leadMap.get(quote.leadId) : undefined
      if (query) {
        const haystack = [
          quote.number,
          quote.originAddress,
          quote.originCity,
          quote.destCity,
          quote.status,
          lead?.name,
          lead?.phone,
          lead?.email,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) continue
      }
      if (quote.status === 'accepted' || quote.status === 'invoiced') groups.accepted.push(quote)
      else if (quote.status === 'declined') groups.declined.push(quote)
      else if (quote.status === 'sent' || quote.status === 'viewed') groups.sent.push(quote)
      else groups.draft.push(quote)
    }
    return groups
  }, [leadMap, query, quotes])

  return (
    <div className="crm-shell space-y-6">
      <section className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Quotes</h1>
          <div className="mt-2 text-sm text-[var(--app-muted)]">
            {quotes.length} total quotes · {grouped.sent.length} active · {formatMoney(grouped.accepted.reduce((sum, item) => sum + item.total, 0))} accepted
          </div>
        </div>
        <button onClick={() => void refresh()} className="crm-button">Refresh</button>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading quotes...</div>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-8">
            {[
              { key: 'draft', label: 'Draft' },
              { key: 'sent', label: 'Sent' },
              { key: 'accepted', label: 'Accepted' },
              { key: 'declined', label: 'Declined' },
            ].map(section => (
              <div key={section.key}>
                <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                  <h2 className="font-display text-[1.35rem] font-semibold tracking-tight text-[var(--app-ink)]">{section.label}</h2>
                  <span className="text-xs text-[var(--app-muted)]">{grouped[section.key].length} items</span>
                </div>
                <div className="space-y-2">
                  {grouped[section.key].map(quote => {
                    const lead = quote.leadId ? leadMap.get(quote.leadId) : undefined
                    const expiryDays = (quote.status === 'sent' || quote.status === 'viewed') ? daysUntilExpiry(quote) : null
                    const isExpiringSoon = expiryDays !== null && expiryDays <= 7
                    const today = dateStamp()
                    return (
                      <Link
                        key={quote.id}
                        href={`/sales/quotes/${quote.id}`}
                        className={`grid grid-cols-[minmax(0,1fr)_120px] items-start gap-4 rounded-[8px] border px-4 py-4 transition hover:border-[var(--app-ink)] ${isExpiringSoon ? 'border-amber-200 bg-amber-50/40' : 'border-[var(--app-line)] bg-[var(--app-panel)]'}`}
                      >
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-lg font-semibold text-[var(--app-ink)]">{quote.number}</div>
                            {isExpiringSoon ? (
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${expiryDays !== null && expiryDays <= 2 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                {expiryDays === 0 ? 'Expires today' : expiryDays === 1 ? 'Expires tomorrow' : `${expiryDays}d left`}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-[var(--app-muted)]">
                            {lead?.name || 'Unknown client'} · {quote.originCity || 'Origin TBD'} → {quote.destCity || 'Destination TBD'}
                          </div>
                          <div className="mt-2 text-xs text-[var(--app-muted)]">
                            Created {formatDate(quote.createdAt)} · Valid until {validUntil(quote)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-[var(--app-ink)]">{formatMoney(quote.total)}</div>
                          <div className="mt-2 text-xs text-[var(--app-muted)] capitalize">{quote.status}</div>
                        </div>
                      </Link>
                    )
                  })}
                  {grouped[section.key].length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-10 text-sm text-[var(--app-muted)]">
                      No {section.label.toLowerCase()} quotes yet.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </section>

          <aside className="space-y-6">
            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-6">
              <div className="crm-label">Quote Performance</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-3xl font-semibold text-[var(--app-ink)]">{grouped.sent.length}</div>
                  <div className="text-sm text-[var(--app-muted)]">Awaiting response</div>
                </div>
                <div>
                  <div className="text-3xl font-semibold text-[var(--app-ink)]">{grouped.accepted.length}</div>
                  <div className="text-sm text-[var(--app-muted)]">Accepted</div>
                </div>
                <div>
                  {(() => {
                    const decided = grouped.accepted.length + grouped.declined.length
                    const rate = decided > 0 ? Math.round((grouped.accepted.length / decided) * 100) : null
                    return (
                      <>
                        <div className="text-3xl font-semibold text-[var(--app-ink)]">{rate !== null ? `${rate}%` : '—'}</div>
                        <div className="text-sm text-[var(--app-muted)]">Close rate</div>
                      </>
                    )
                  })()}
                </div>
                <div>
                  {(() => {
                    const expiring = quotes.filter(q => (q.status === 'sent' || q.status === 'viewed') && daysUntilExpiry(q) !== null && (daysUntilExpiry(q) as number) <= 7).length
                    return (
                      <>
                        <div className={`text-3xl font-semibold ${expiring > 0 ? 'text-amber-600' : 'text-[var(--app-ink)]'}`}>{expiring}</div>
                        <div className="text-sm text-[var(--app-muted)]">Expiring in 7d</div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-6">
              <div className="crm-label">Recent Views</div>
              <div className="mt-4 space-y-3">
                {quotes
                  .filter(item => item.viewedAt)
                  .sort((a, b) => new Date(b.viewedAt || '').getTime() - new Date(a.viewedAt || '').getTime())
                  .slice(0, 5)
                  .map(item => (
                    <Link key={item.id} href={`/sales/quotes/${item.id}`} className="block rounded-[6px] border border-transparent px-3 py-3 transition hover:border-[var(--app-line)] hover:bg-[var(--app-bg)]">
                      <div className="text-sm font-medium text-[var(--app-ink)]">{item.number}</div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">Viewed {formatDate(item.viewedAt)}</div>
                    </Link>
                  ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
