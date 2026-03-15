'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { deleteSalesLead, fetchSalesOverview } from '@/lib/sales-api'
import { formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

const COLUMN_ORDER: CRMLead['stage'][] = ['new', 'contacted', 'pricing', 'quoted', 'nurture', 'booked', 'lost']

const COLUMN_LABELS: Record<CRMLead['stage'], string> = {
  new: 'New Inquiry',
  contacted: 'Contacted',
  pricing: 'Estimating',
  quoted: 'Quote Sent',
  nurture: 'Nurture',
  booked: 'Booked',
  lost: 'Lost',
}

function SalesPipelineContent() {
  const searchParams = useSearchParams()
  const query = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board')

  async function refresh() {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setQuotes(data.quotes)
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

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  async function removeLead(event: MouseEvent, lead: CRMLead) {
    event.preventDefault()
    event.stopPropagation()

    const previousLeads = leads
    try {
      setDeleteBusyId(lead.id)
      setLeads(current => current.filter(item => item.id !== lead.id))
      await deleteSalesLead(lead.id)
    } catch (err) {
      setLeads(previousLeads)
      setError((err as Error).message)
    } finally {
      setDeleteBusyId(null)
    }
  }

  const quoteMap = useMemo(() => new Map(quotes.map(item => [item.id, item])), [quotes])
  const grouped = useMemo(() => {
    return COLUMN_ORDER.map(stage => ({
      stage,
      label: COLUMN_LABELS[stage],
      cards: leads
        .filter(lead => lead.stage === stage)
        .filter(lead => {
          if (!query) return true
          const haystack = [
            lead.name,
            lead.phone,
            lead.email,
            lead.originAddress,
            lead.originCity,
            lead.destAddress,
            lead.destCity,
            lead.moveType,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return haystack.includes(query)
        })
        .sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0)),
    }))
  }, [leads, query])
  const visibleLeads = useMemo(() => grouped.flatMap(column => column.cards), [grouped])

  return (
    <div className="crm-shell space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Pipeline Board</h1>
          <div className="mt-2 text-sm text-[var(--app-muted)]">
            {leads.length} active leads · {quotes.length} quotes · {formatMoney(quotes.reduce((sum, item) => sum + item.total, 0))} total quote value
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
            <button
              onClick={() => setViewMode('board')}
              className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                viewMode === 'board' ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'
              }`}
            >
              Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                viewMode === 'list' ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'
              }`}
            >
              List
            </button>
          </div>
          <button onClick={() => void refresh()} className="crm-button">Refresh</button>
        </div>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading pipeline...</div>
      ) : viewMode === 'board' ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4">
            {grouped.map(column => (
              <div key={column.stage} className="w-[290px]">
                <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-3">
                  <h2 className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-ink)]">{column.label}</h2>
                  <span className="rounded-[4px] bg-[var(--app-wash)] px-2 py-0.5 text-xs text-[var(--app-muted)]">{column.cards.length}</span>
                </div>
                <div className="space-y-3">
                  {column.cards.map(lead => {
                    const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
                    return (
                      <Link
                        key={lead.id}
                        href={`/sales/leads/${lead.id}`}
                        className="block rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4 transition hover:border-[var(--app-ink)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                            <div className="mt-1 text-xs text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'} · {lead.moveType || 'Move TBD'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-[4px] bg-[rgba(15,106,83,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-accent)]">
                              {lead.leadScore || 0}
                            </span>
                            <button
                              onClick={event => void removeLead(event, lead)}
                              className="text-xs text-[var(--app-muted)] hover:text-rose-700"
                            >
                              {deleteBusyId === lead.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-[var(--app-muted)]">
                          <span>{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</span>
                          <span>{quote ? formatMoney(quote.total) : 'Est. pending'}</span>
                        </div>
                        <div className="mt-3 border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                          {quote?.viewedAt ? `Viewed ${formatDate(quote.viewedAt)}` : lead.followUpDate ? `Follow up ${formatDate(lead.followUpDate)}` : 'No follow-up set'}
                        </div>
                      </Link>
                    )
                  })}
                  {column.cards.length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                      No leads here yet.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {visibleLeads.map(lead => {
              const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
              return (
                <Link
                  key={lead.id}
                  href={`/sales/leads/${lead.id}`}
                  className="block rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-4 transition hover:border-[var(--app-ink)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">{COLUMN_LABELS[lead.stage]} · {lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                    </div>
                    <button
                      onClick={event => void removeLead(event, lead)}
                      className="text-xs text-[var(--app-muted)] hover:text-rose-700"
                    >
                      {deleteBusyId === lead.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                  <div className="mt-3 text-sm text-[var(--app-muted)]">{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</div>
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                    <span>{quote ? formatMoney(quote.total) : 'Estimate pending'}</span>
                    <span>{lead.followUpDate ? `Follow up ${formatDate(lead.followUpDate)}` : 'No follow-up set'}</span>
                  </div>
                </Link>
              )
            })}
            {visibleLeads.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-10 text-center text-sm text-[var(--app-muted)]">
                No leads matched this view.
              </div>
            ) : null}
          </div>
          <div className="hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] md:block">
          <div className="grid grid-cols-[minmax(0,1.2fr)_140px_150px_170px_110px] gap-4 border-b border-[var(--app-line)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
            <div>Lead</div>
            <div>Stage</div>
            <div>Move Date</div>
            <div>Route</div>
            <div>Action</div>
          </div>
          {visibleLeads.map(lead => {
            const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
            return (
              <Link
                key={lead.id}
                href={`/sales/leads/${lead.id}`}
                className="grid grid-cols-[minmax(0,1.2fr)_140px_150px_170px_110px] gap-4 border-b border-[var(--app-line)] px-5 py-4 text-sm transition hover:bg-[var(--app-bg)]"
              >
                <div>
                  <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">{quote ? formatMoney(quote.total) : 'Estimate pending'}</div>
                </div>
                <div className="text-[var(--app-ink)] capitalize">{COLUMN_LABELS[lead.stage]}</div>
                <div className="text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                <div className="text-[var(--app-muted)]">{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</div>
                <div>
                  <button
                    onClick={event => void removeLead(event, lead)}
                    className="text-xs text-[var(--app-muted)] hover:text-rose-700"
                  >
                    {deleteBusyId === lead.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </Link>
            )
          })}
          {visibleLeads.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-[var(--app-muted)]">No leads matched this view.</div>
          ) : null}
        </div>
        </>
      )}
    </div>
  )
}

export default function SalesPipelinePage() {
  return (
    <Suspense fallback={<div className="crm-shell"><div className="crm-panel px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading pipeline...</div></div>}>
      <SalesPipelineContent />
    </Suspense>
  )
}
