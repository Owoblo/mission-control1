'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { deleteSalesLead, fetchSalesOverview, updateSalesLead } from '@/lib/sales-api'
import { formatDate, formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

const COLUMN_ORDER: CRMLead['stage'][] = ['new', 'contacted', 'estimate_scheduled', 'estimate_completed', 'pricing', 'quoted', 'nurture', 'booked', 'lost']

const COLUMN_LABELS: Record<CRMLead['stage'], string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  estimate_scheduled: 'Estimate Scheduled',
  estimate_completed: 'Estimate Done',
  pricing: 'Building Quote',
  quoted: 'Quote Sent',
  nurture: 'Shopping Around',
  booked: 'Booked',
  lost: 'Lost',
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_call: 'Inbound Call',
  twilio_sms: 'SMS',
  facebook_dm: 'Facebook',
  instagram_dm: 'Instagram',
  email: 'Email',
  website_form: 'Website Form',
  manual: 'Manual Entry',
  direct_mail: 'Direct Mail',
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
  const [filterSource, setFilterSource] = useState('')
  const [filterCity, setFilterCity] = useState('')
  const [filterRep, setFilterRep] = useState('')

  // Drag-and-drop state
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<CRMLead['stage'] | null>(null)

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
    // Auto-refresh every 30s so new leads and stage changes appear without manual refresh
    const interval = setInterval(() => {
      fetchSalesOverview()
        .then(data => {
          setLeads(data.leads)
          setQuotes(data.quotes)
        })
        .catch(() => {/* silently ignore */})
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setViewMode('list')
    }
  }, [])

  async function removeLead(event: MouseEvent, lead: CRMLead) {
    event.preventDefault()
    event.stopPropagation()

    if (!window.confirm(`Delete lead for ${lead.name}?`)) return

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

  async function moveLeadToStage(leadId: string, newStage: CRMLead['stage']) {
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.stage === newStage) return

    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l))

    try {
      await updateSalesLead(leadId, { stage: newStage })
    } catch (err) {
      // Rollback
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: lead.stage } : l))
      setError((err as Error).message)
    }
  }

  function handleDragStart(leadId: string) {
    setDraggedLeadId(leadId)
  }

  function handleDragEnd() {
    setDraggedLeadId(null)
    setDragOverStage(null)
  }

  function handleDragOver(e: React.DragEvent, stage: CRMLead['stage']) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stage)
  }

  function handleDragLeave() {
    setDragOverStage(null)
  }

  async function handleDrop(e: React.DragEvent, stage: CRMLead['stage']) {
    e.preventDefault()
    setDragOverStage(null)
    if (!draggedLeadId) return
    await moveLeadToStage(draggedLeadId, stage)
    setDraggedLeadId(null)
  }

  const quoteMap = useMemo(() => new Map(quotes.map(item => [item.id, item])), [quotes])

  const sourceOptions = useMemo(() => {
    const set = new Set(leads.map(l => l.source).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [leads])

  const cityOptions = useMemo(() => {
    const set = new Set(leads.map(l => l.originCity).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [leads])

  const repOptions = useMemo(() => {
    const set = new Set(leads.map(l => l.assignedRep).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [leads])

  const activeFilterCount = [filterSource, filterCity, filterRep].filter(Boolean).length

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
        .filter(lead => !filterSource || lead.source === filterSource)
        .filter(lead => !filterCity || lead.originCity === filterCity)
        .filter(lead => !filterRep || lead.assignedRep === filterRep)
        .sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0)),
    }))
  }, [leads, query, filterSource, filterCity, filterRep])
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

      {/* ── FILTER BAR ── */}
      <section className="flex flex-wrap items-center gap-2">
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterSource ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}
        >
          <option value="">All Sources</option>
          {sourceOptions.map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>
          ))}
        </select>

        <select
          value={filterCity}
          onChange={e => setFilterCity(e.target.value)}
          className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterCity ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}
        >
          <option value="">All Cities</option>
          {cityOptions.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filterRep}
          onChange={e => setFilterRep(e.target.value)}
          className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterRep ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}
        >
          <option value="">All Reps</option>
          {repOptions.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {activeFilterCount > 0 && (
          <button
            onClick={() => { setFilterSource(''); setFilterCity(''); setFilterRep('') }}
            className="flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
          >
            Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} ✕
          </button>
        )}

        <span className="ml-auto text-xs text-[var(--app-muted)]">
          {visibleLeads.length} of {leads.length} leads
          {draggedLeadId && <span className="ml-2 text-[var(--app-accent)]">· Drop to move stage</span>}
        </span>
      </section>

      {error ? <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading pipeline...</div>
      ) : viewMode === 'board' ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4">
            {grouped.map(column => (
              <div
                key={column.stage}
                className="w-[290px]"
                onDragOver={e => handleDragOver(e, column.stage)}
                onDragLeave={handleDragLeave}
                onDrop={e => void handleDrop(e, column.stage)}
              >
                <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-3">
                  <h2 className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-[var(--app-ink)]">{column.label}</h2>
                  <span className="rounded-[4px] bg-[var(--app-wash)] px-2 py-0.5 text-xs text-[var(--app-muted)]">{column.cards.length}</span>
                </div>

                {/* Drop zone — highlighted when dragging over */}
                <div
                  className={`min-h-[120px] space-y-3 rounded-[8px] transition-all duration-150 ${
                    dragOverStage === column.stage
                      ? 'bg-[rgba(15,106,83,0.06)] ring-2 ring-[var(--app-accent)] ring-inset'
                      : draggedLeadId
                      ? 'bg-[var(--app-bg)] ring-1 ring-[var(--app-line)] ring-inset'
                      : ''
                  } p-1`}
                >
                  {column.cards.map(lead => {
                    const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
                    const isDragging = draggedLeadId === lead.id
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => handleDragStart(lead.id)}
                        onDragEnd={handleDragEnd}
                        className={`relative rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] transition hover:border-[var(--app-ink)] ${
                          isDragging ? 'opacity-40 ring-2 ring-[var(--app-accent)]' : 'cursor-grab active:cursor-grabbing'
                        }`}
                      >
                        {/* Drag handle hint */}
                        <div className="absolute left-2 top-1/2 -translate-y-1/2 select-none text-[10px] text-[var(--app-line)] hover:text-[var(--app-muted)]">⠿</div>

                        <button
                          onClick={event => void removeLead(event, lead)}
                          className="absolute right-3 top-3 z-10 text-xs text-[var(--app-muted)] hover:text-rose-700"
                        >
                          {deleteBusyId === lead.id ? 'Deleting...' : '✕'}
                        </button>
                        <Link href={`/sales/leads/${lead.id}`} className="block pl-6 pr-4 pt-4 pb-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                              <div className="mt-1 text-xs text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'} · {lead.moveType || 'Move TBD'}</div>
                            </div>
                            <span className="mr-5 rounded-[4px] bg-[rgba(15,106,83,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-accent)]">
                              {lead.leadScore || 0}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs text-[var(--app-muted)]">
                            <span>{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</span>
                            <span>{quote ? formatMoney(quote.total) : 'Est. pending'}</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                            <span>{quote?.viewedAt ? `Viewed ${formatDate(quote.viewedAt)}` : lead.followUpDate ? `Follow up ${formatDate(lead.followUpDate)}` : 'No follow-up set'}</span>
                            <div className="flex items-center gap-1.5">
                              {lead.assignedRep ? <span className="rounded-full bg-[var(--app-wash)] px-2 py-0.5 font-medium text-[var(--app-ink)]">{lead.assignedRep}</span> : null}
                              {lead.phone ? (
                                <button
                                  onClick={e => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id, name: lead.name } })) }}
                                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--app-line)] bg-white text-[var(--app-muted)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-accent)]"
                                  title={`Call ${lead.phone}`}
                                >
                                  ☎
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      </div>
                    )
                  })}
                  {column.cards.length === 0 ? (
                    <div className={`rounded-[8px] border border-dashed px-4 py-12 text-center text-sm transition ${
                      dragOverStage === column.stage
                        ? 'border-[var(--app-accent)] text-[var(--app-accent)]'
                        : 'border-[var(--app-line)] text-[var(--app-muted)]'
                    }`}>
                      {dragOverStage === column.stage ? 'Drop here →' : 'No leads here yet.'}
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
                <div key={lead.id} className="relative rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] transition hover:border-[var(--app-ink)]">
                  <button
                    onClick={event => void removeLead(event, lead)}
                    className="absolute right-3 top-3 z-10 text-xs text-[var(--app-muted)] hover:text-rose-700"
                  >
                    {deleteBusyId === lead.id ? 'Deleting...' : '✕'}
                  </button>
                  <Link href={`/sales/leads/${lead.id}`} className="block p-4">
                  <div className="flex items-start justify-between gap-3 pr-12">
                    <div>
                      <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">{COLUMN_LABELS[lead.stage]} · {lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[var(--app-muted)]">{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</div>
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--app-line)] pt-3 text-xs text-[var(--app-muted)]">
                    <span>{quote ? formatMoney(quote.total) : 'Estimate pending'}</span>
                    <span>{lead.followUpDate ? `Follow up ${formatDate(lead.followUpDate)}` : 'No follow-up set'}</span>
                  </div>
                  </Link>
                </div>
              )
            })}
            {visibleLeads.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-10 text-center text-sm text-[var(--app-muted)]">
                No leads matched this view.
              </div>
            ) : null}
          </div>
          <div className="hidden rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] md:block">
          <div className="grid grid-cols-[minmax(0,1.2fr)_140px_150px_170px_100px_110px] gap-4 border-b border-[var(--app-line)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
            <div>Lead</div>
            <div>Stage</div>
            <div>Move Date</div>
            <div>Route</div>
            <div>Rep</div>
            <div>Action</div>
          </div>
          {visibleLeads.map(lead => {
            const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
            return (
              <Link
                key={lead.id}
                href={`/sales/leads/${lead.id}`}
                className="grid grid-cols-[minmax(0,1.2fr)_140px_150px_170px_100px_110px] gap-4 border-b border-[var(--app-line)] px-5 py-4 text-sm transition hover:bg-[var(--app-bg)]"
              >
                <div>
                  <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">{quote ? formatMoney(quote.total) : 'Estimate pending'}</div>
                </div>
                <div className="text-[var(--app-ink)] capitalize">{COLUMN_LABELS[lead.stage]}</div>
                <div className="text-[var(--app-muted)]">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                <div className="text-[var(--app-muted)]">{lead.originCity || 'Origin TBD'} → {lead.destCity || 'Destination TBD'}</div>
                <div className="text-[var(--app-muted)]">{lead.assignedRep || '—'}</div>
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
