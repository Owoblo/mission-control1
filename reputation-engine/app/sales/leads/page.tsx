'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { compareLeadsByGuidance, formatRelativeTime, getLeadGuidance } from '@/lib/lead-guidance'
import { deleteSalesLead, fetchDeletedSalesLeads, fetchSalesOverview, restoreDeletedSalesLead, updateSalesLead } from '@/lib/sales-api'
import { formatDate, getLeadAssignedRepName, isBookedLikeStage, isClosedLeadStage } from '@/lib/sales'
import type { CRMLead, CRMQuote, FollowUpLog } from '@/lib/types'

type LeadViewMode = 'focus' | 'booked' | 'all' | 'realtor' | 'deleted'
type DeletedLeadRow = CRMLead & { _deletedAt?: string }
type DecoratedLeadRow = {
  lead: CRMLead
  quote: CRMQuote | null
  guidance: ReturnType<typeof getLeadGuidance>
  isBooked: boolean
  isClosed: boolean
  isActionable: boolean
}

const LEAD_VIEW_MODES: Array<{ id: LeadViewMode; label: string; description: string }> = [
  { id: 'focus', label: 'Needs Follow-Up', description: 'Only leads with a live next action.' },
  { id: 'booked', label: 'Booked', description: 'Booked and completed jobs that still matter operationally.' },
  { id: 'all', label: 'All Active', description: 'Everything active except deleted and lost.' },
  { id: 'realtor', label: '🏠 Realtor Opps', description: 'Destination-side leads — pitch the listing agent for the current occupant\'s move.' },
  { id: 'deleted', label: 'Deleted', description: 'Recently removed leads that can still be restored.' },
]

function matchesLeadQuery(lead: CRMLead, query: string) {
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
}

function heatBadgeClasses(tone: ReturnType<typeof getLeadGuidance>['heat']['tone']) {
  if (tone === 'risk') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (tone === 'hot') return 'border-orange-200 bg-orange-50 text-orange-700'
  if (tone === 'warm') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'dormant') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
  return 'border-slate-200 bg-slate-50 text-slate-600'
}

function stageClasses(stage: CRMLead['stage']) {
  if (stage === 'tentative') return 'border-orange-300 bg-orange-50 text-orange-700'
  if (stage === 'customer_success') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (stage === 'completed') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  if (stage === 'booked') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (stage === 'lost') return 'border-rose-200 bg-rose-50 text-rose-600'
  return 'border-[var(--app-line)] text-[var(--app-muted)]'
}

function moveDateLabel(lead: CRMLead, quote: CRMQuote | null) {
  const date = quote?.moveDate || lead.moveDate
  return date ? formatDate(date) : 'Date TBD'
}

function sortBookedLeads(left: DecoratedLeadRow, right: DecoratedLeadRow) {
  const leftDate = new Date(left.quote?.moveDate || left.lead.moveDate || left.lead.createdAt).getTime()
  const rightDate = new Date(right.quote?.moveDate || right.lead.moveDate || right.lead.createdAt).getTime()
  return leftDate - rightDate
}

function SalesLeadsIndexContent() {
  const searchParams = useSearchParams()
  const currentUser = useCurrentUser()
  const query = searchParams.get('q')?.trim().toLowerCase() ?? ''
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [deletedLeads, setDeletedLeads] = useState<DeletedLeadRow[]>([])
  const [viewMode, setViewMode] = useState<LeadViewMode>('focus')
  const [loading, setLoading] = useState(true)
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)
  const [rowActionId, setRowActionId] = useState<string | null>(null)

  const canManageLeadLifecycle = currentUser?.role === 'owner' || currentUser?.role === 'manager'

  async function loadDeletedLeads() {
    try {
      setDeletedLoading(true)
      const data = await fetchDeletedSalesLeads()
      setDeletedLeads(data as DeletedLeadRow[])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletedLoading(false)
    }
  }

  async function refresh(options?: { includeDeleted?: boolean }) {
    try {
      setLoading(true)
      const data = await fetchSalesOverview()
      setLeads(data.leads)
      setQuotes(data.quotes)
      setFollowUps(data.followUps)
      if (options?.includeDeleted) {
        await loadDeletedLeads()
      }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function syncCallHistory() {
    try {
      setBackfilling(true)
      setBackfillResult(null)
      const res = await fetch('/api/sales/dialer/backfill-calls', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; mapped?: number; patched?: number; skipped?: number; newLeadsCreated?: number; error?: string }
      if (data.error) {
        setBackfillResult(`Error: ${data.error}`)
      } else {
        const parts = []
        if (data.mapped) parts.push(`${data.mapped} new calls logged`)
        if (data.patched) parts.push(`${data.patched} recordings attached`)
        if (data.newLeadsCreated) parts.push(`${data.newLeadsCreated} new leads created`)
        setBackfillResult(parts.length ? `Done — ${parts.join(', ')}.` : 'Done — everything is up to date.')
        void refresh({ includeDeleted: viewMode === 'deleted' })
      }
    } catch {
      setBackfillResult('Failed to sync call history.')
    } finally {
      setBackfilling(false)
    }
  }

  async function handleDeleteLead(lead: CRMLead) {
    if (!canManageLeadLifecycle) {
      setError('Only a manager or the owner can delete leads.')
      return
    }
    if (!window.confirm(`Delete ${lead.name || 'this lead'} from the active queue? You can restore it from Deleted later.`)) {
      return
    }

    try {
      setRowActionId(lead.id)
      await deleteSalesLead(lead.id)
      setLeads(current => current.filter(item => item.id !== lead.id))
      if (viewMode === 'deleted') {
        await loadDeletedLeads()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRowActionId(null)
    }
  }

  async function handleRestoreLead(lead: DeletedLeadRow) {
    if (!canManageLeadLifecycle) {
      setError('Only a manager or the owner can restore leads.')
      return
    }

    try {
      setRowActionId(lead.id)
      await restoreDeletedSalesLead(lead.id)
      setDeletedLeads(current => current.filter(item => item.id !== lead.id))
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRowActionId(null)
    }
  }

  async function handleMarkNotInterested(lead: CRMLead) {
    try {
      setRowActionId(lead.id)
      await updateSalesLead(lead.id, {
        stage: 'lost',
        lostReason: 'not_interested',
        lostAt: new Date().toISOString(),
      })
      setLeads(current => current.filter(item => item.id !== lead.id))
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.includes('only edit') || msg.includes('403')) {
        setError(`Can't mark "${lead.name}" as lost — this lead is assigned to another rep. Ask your manager to update it.`)
      } else {
        setError(msg || 'Failed to update lead.')
      }
    } finally {
      setRowActionId(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Re-fetch when the user returns to this page after editing a lead elsewhere.
  // Next.js keeps this component mounted during client-side nav, so the initial
  // useEffect only fires once per session — visibilitychange catches the "back" case.
  useEffect(() => {
    function handleVisible() {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [])

  useEffect(() => {
    if (viewMode === 'deleted' && deletedLeads.length === 0 && !deletedLoading) {
      void loadDeletedLeads()
    }
  }, [deletedLeads.length, deletedLoading, viewMode])

  const today = new Date().toISOString().slice(0, 10)

  const decoratedLeads = useMemo<DecoratedLeadRow[]>(() => {
    const quoteMap = new Map(quotes.map(item => [item.id, item]))
    const filtered = leads.filter(lead => matchesLeadQuery(lead, query))
    return filtered.map(lead => {
      const quote = lead.quoteId ? quoteMap.get(lead.quoteId) || null : null
      const guidance = getLeadGuidance(lead, quote, followUps)
      const isBooked = isBookedLikeStage(lead.stage)
      const isClosed = isClosedLeadStage(lead.stage)
      const isActionable = !isBooked && !isClosed && guidance.action.priority >= 50
      return { lead, quote, guidance, isBooked, isClosed, isActionable }
    })
  }, [followUps, leads, query, quotes])

  const focusLeads = useMemo(
    () => decoratedLeads.filter(item => item.isActionable).sort((left, right) => compareLeadsByGuidance(left, right)),
    [decoratedLeads]
  )
  const bookedLeads = useMemo(
    () => decoratedLeads.filter(item => item.isBooked).sort(sortBookedLeads),
    [decoratedLeads]
  )
  const activeLeads = useMemo(
    () => decoratedLeads.filter(item => !item.isClosed || item.isBooked).sort((left, right) => compareLeadsByGuidance(left, right)),
    [decoratedLeads]
  )
  const realtorLeads = useMemo(
    () => decoratedLeads
      .filter(item => item.lead.leadKind === 'realtor_opportunity' && !item.isClosed)
      .sort((a, b) => {
        // Un-pitched first, then by follow-up date
        const aPitched = !!a.lead.realtorOutreachStartedAt
        const bPitched = !!b.lead.realtorOutreachStartedAt
        if (aPitched !== bPitched) return aPitched ? 1 : -1
        return (a.lead.followUpDate || '').localeCompare(b.lead.followUpDate || '')
      }),
    [decoratedLeads]
  )
  const visibleDeletedLeads = useMemo(
    () =>
      [...deletedLeads]
        .filter(lead => matchesLeadQuery(lead, query))
        .sort((left, right) => new Date(right._deletedAt || right.createdAt).getTime() - new Date(left._deletedAt || left.createdAt).getTime()),
    [deletedLeads, query]
  )

  const todaysCallList = useMemo(
    () => decoratedLeads.filter(({ lead }) =>
      lead.followUpDate && lead.followUpDate <= today &&
      !isBookedLikeStage(lead.stage) && !isClosedLeadStage(lead.stage)
    ).sort((a, b) => (a.lead.followUpDate || '').localeCompare(b.lead.followUpDate || '')),
    [decoratedLeads, today]
  )

  const visibleLeads = viewMode === 'focus' ? focusLeads : viewMode === 'booked' ? bookedLeads : viewMode === 'realtor' ? realtorLeads : activeLeads
  const emptyText =
    viewMode === 'focus'
      ? 'No leads currently need live follow-up.'
      : viewMode === 'booked'
        ? 'No booked jobs match this filter.'
        : viewMode === 'realtor'
          ? 'No realtor opportunity leads yet. They auto-generate when a customer\'s destination is set.'
          : viewMode === 'deleted'
            ? 'No deleted leads found.'
            : 'No active leads match this filter.'

  return (
    <div className="crm-shell space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Leads</h1>
          <div className="mt-1 text-sm text-[var(--app-muted)]">What needs a response or decision now.</div>
        </div>
        <details className="relative self-start lg:self-auto">
          <summary className="crm-button cursor-pointer list-none">Tools</summary>
          <div className="absolute right-0 z-30 mt-2 grid w-52 gap-1 rounded-[10px] border border-[var(--app-line)] bg-white p-2 shadow-lg">
            <button onClick={() => void refresh({ includeDeleted: viewMode === 'deleted' })} className="rounded-[7px] px-3 py-2 text-left text-sm hover:bg-[var(--app-bg)]">Refresh data</button>
            <button onClick={() => void syncCallHistory()} disabled={backfilling} className="rounded-[7px] px-3 py-2 text-left text-sm hover:bg-[var(--app-bg)] disabled:opacity-50">{backfilling ? 'Syncing…' : 'Sync call history'}</button>
            <Link href="/sales/cleanup" className="rounded-[7px] px-3 py-2 text-sm text-[var(--app-muted)] hover:bg-[var(--app-bg)] hover:text-rose-700">Review junk leads</Link>
          </div>
        </details>
      </section>

      <section className="border-b border-[var(--app-line)] pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {LEAD_VIEW_MODES.map(mode => {
              const count =
                mode.id === 'focus'
                  ? focusLeads.length
                  : mode.id === 'booked'
                    ? bookedLeads.length
                    : mode.id === 'realtor'
                      ? realtorLeads.length
                      : mode.id === 'deleted'
                        ? deletedLeads.length
                        : activeLeads.length
              const active = viewMode === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setViewMode(mode.id)}
                  className={`rounded-[7px] border px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)]'
                  }`}
                >
                  {mode.label} · {count}
                </button>
              )
            })}
          </div>
          <div className="text-sm text-[var(--app-muted)]">
            {LEAD_VIEW_MODES.find(mode => mode.id === viewMode)?.description}
          </div>
        </div>
      </section>

      {/* Today's Calls / Overdue Follow-ups */}
      {viewMode !== 'deleted' && viewMode !== 'booked' && todaysCallList.length > 0 && (
        <section className="overflow-hidden rounded-[10px] border border-[var(--app-line)] bg-white">
          <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-3">
            <span className="text-sm font-semibold text-[var(--app-ink)]">
              {todaysCallList.filter(({ lead }) => (lead.followUpDate || '') < today).length > 0
                ? `${todaysCallList.filter(({ lead }) => (lead.followUpDate || '') < today).length} overdue · `
                : ''}{todaysCallList.filter(({ lead }) => lead.followUpDate === today).length} due today
            </span>
            <span className="text-xs text-[var(--app-muted)]">Call queue</span>
          </div>
          <div className="divide-y divide-[var(--app-line)]">
            {todaysCallList.slice(0, 6).map(({ lead, guidance }) => (
              <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="group flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-[var(--app-bg)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {(lead.followUpDate || '') < today && (
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                    )}
                    <span className="font-medium text-[var(--app-ink)]">{lead.name || 'Unnamed'}</span>
                    <span className="text-xs text-[var(--app-muted)]">{(lead.followUpDate || '') < today ? `Overdue since ${lead.followUpDate}` : 'Due today'}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--app-muted)]">{guidance.action.nextAction}</div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-[var(--app-accent)] opacity-0 transition group-hover:opacity-100">Open →</span>
              </Link>
            ))}
          </div>
          {todaysCallList.length > 6 ? <div className="border-t border-[var(--app-line)] px-5 py-2 text-xs text-[var(--app-muted)]">Showing the 6 oldest. {todaysCallList.length - 6} remain in the Follow-Up queue.</div> : null}
        </section>
      )}

      {backfillResult ? (
        <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3 text-sm text-[var(--app-ink)]">
          {backfillResult}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between gap-4 rounded-[8px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          <span>{error.includes('aborted') || error.includes('timeout') ? 'Lead data took too long to load. Your records are safe.' : error}</span>
          <button type="button" onClick={() => void refresh()} className="shrink-0 rounded-[7px] border border-rose-300 bg-white px-3 py-1.5 font-semibold hover:bg-rose-100">Retry</button>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading leads...</div>
      ) : viewMode === 'deleted' ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
          <div className="border-b border-[var(--app-line)] px-5 py-3 text-sm text-[var(--app-muted)]">
            Deleted leads stay out of the rep workflow but can be restored here.
          </div>
          {deletedLoading ? (
            <div className="px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading deleted leads...</div>
          ) : visibleDeletedLeads.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-[var(--app-muted)]">{emptyText}</div>
          ) : (
            <div className="divide-y divide-[var(--app-line)]">
              {visibleDeletedLeads.map(lead => (
                <div key={lead.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-[var(--app-ink)]">{lead.name || 'Unnamed lead'}</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${stageClasses(lead.stage)}`}>
                        {lead.stage.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--app-muted)]">
                      {lead.originAddress || lead.originCity || 'Origin TBD'} → {lead.destAddress || lead.destCity || 'Destination TBD'}
                    </div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">
                      Deleted {formatRelativeTime(lead._deletedAt || lead.createdAt)} · Owner {getLeadAssignedRepName(lead) || 'Unassigned'}
                    </div>
                  </div>
                  {canManageLeadLifecycle ? (
                    <button
                      type="button"
                      onClick={() => void handleRestoreLead(lead)}
                      disabled={rowActionId === lead.id}
                      className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      {rowActionId === lead.id ? 'Restoring...' : 'Restore Lead'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)]">
          <div className="space-y-3 p-3 md:hidden">
            {visibleLeads.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                {emptyText}
              </div>
            ) : (
              visibleLeads.map(({ lead, quote, guidance }) => (
                <div key={lead.id} className="rounded-[18px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-medium text-[var(--app-ink)]">{lead.name}</div>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${heatBadgeClasses(guidance.heat.tone)}`}>
                          {guidance.heat.label} · {guidance.heat.score}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">
                        {guidance.stageLabel} · {guidance.branchLabel} · Owner {guidance.ownerLabel}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${stageClasses(lead.stage)}`}>
                      {guidance.stageLabel}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-[var(--app-muted)]">
                    {lead.originAddress || lead.originCity || 'Origin TBD'} → {lead.destAddress || lead.destCity || 'Destination TBD'}
                  </div>
                  <div className="mt-3 rounded-[12px] bg-white px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Next Action</div>
                    <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">{guidance.action.nextAction}</div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">{guidance.action.reason}</div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Move</div>
                      <div className="mt-1 text-[var(--app-ink)]">{moveDateLabel(lead, quote)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Last Activity</div>
                      <div className="mt-1 text-[var(--app-ink)]">{formatRelativeTime(guidance.latestActivity.at)}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/sales/leads/${lead.id}`} className="crm-button">Open Lead</Link>
                    <button
                      type="button"
                      onClick={() => void handleMarkNotInterested(lead)}
                      disabled={rowActionId === lead.id}
                      className="rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                    >
                      ✕ Not Interested
                    </button>
                    {canManageLeadLifecycle ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteLead(lead)}
                        disabled={rowActionId === lead.id}
                        className="rounded-[8px] border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        {rowActionId === lead.id ? '...' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="hidden md:block">
            <div className="grid grid-cols-[minmax(0,1.2fr)_140px_minmax(0,1fr)_140px_130px_120px] gap-4 border-b border-[var(--app-line)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">
              <div>Lead</div>
              <div>Heat</div>
              <div>Next Action</div>
              <div>Move</div>
              <div>Last Activity</div>
              <div>Actions</div>
            </div>
            {visibleLeads.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-[var(--app-muted)]">{emptyText}</div>
            ) : (
              <div>
                {visibleLeads.map(({ lead, quote, guidance }) => (
                  <div
                    key={lead.id}
                    className="grid grid-cols-[minmax(0,1.2fr)_140px_minmax(0,1fr)_140px_130px_120px] gap-4 border-b border-[var(--app-line)] px-5 py-4 text-sm"
                  >
                    <Link href={`/sales/leads/${lead.id}`} className="min-w-0 hover:opacity-80">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stageClasses(lead.stage)}`}>
                          {guidance.stageLabel}
                        </span>
                        {guidance.action.priority >= 80 && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">⚡ Urgent</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--app-muted)]">
                        {guidance.branchLabel} · Owner {guidance.ownerLabel}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">
                        {lead.originAddress || lead.originCity || 'Origin TBD'} → {lead.destAddress || lead.destCity || 'Destination TBD'}
                      </div>
                    </Link>
                    <div className="self-start">
                      <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${heatBadgeClasses(guidance.heat.tone)}`}>
                        {guidance.heat.label} · {guidance.heat.score}
                      </div>
                      <div className="mt-2 text-xs text-[var(--app-muted)]">{guidance.heat.reasons[0] || 'No heat signal'}</div>
                    </div>
                    <Link href={`/sales/leads/${lead.id}`} className="min-w-0 hover:opacity-80">
                      <div className="font-medium text-[var(--app-ink)]">{guidance.action.nextAction}</div>
                      <div className="mt-1 text-xs text-[var(--app-muted)]">{guidance.action.reason}</div>
                    </Link>
                    <div className="text-[var(--app-ink)]">{moveDateLabel(lead, quote)}</div>
                    <div className="text-[var(--app-muted)]">{formatRelativeTime(guidance.latestActivity.at)}</div>
                    <div className="flex items-start justify-end gap-2">
                      <Link href={`/sales/leads/${lead.id}`} className="rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleMarkNotInterested(lead)}
                        disabled={rowActionId === lead.id}
                        title="Mark as not interested — removes from active pipeline"
                        className="rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                      >
                        ✕ Not Interested
                      </button>
                      {canManageLeadLifecycle ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteLead(lead)}
                          disabled={rowActionId === lead.id}
                          className="rounded-[8px] border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          {rowActionId === lead.id ? '...' : 'Delete'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SalesLeadsIndexPage() {
  return (
    <Suspense fallback={<div className="crm-shell"><div className="crm-panel px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading leads...</div></div>}>
      <SalesLeadsIndexContent />
    </Suspense>
  )
}
