'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const POLL_MS = 15_000

type ActivityItem = {
  id: string
  type: string
  icon: string
  label: string
  detail: string
  repId: string | null
  repName: string
  leadId: string | null
  leadName: string | null
  ts: string
  props: Record<string, unknown>
}

function prop(item: ActivityItem, key: string): string {
  const v = item.props[key]
  return v != null ? String(v) : ''
}

type Summary = {
  total: number
  quotes_sent: number
  calls: number
  sms_sent: number
  bookings: number
  leads_claimed: number
  stage_changes: number
}

type RepActivity = Record<string, { name: string; count: number; types: Record<string, number> }>

type DaysFilter = 1 | 7 | 30
type TypeFilter = '' | 'call_completed' | 'quote_sent' | 'sms_sent' | 'lead_created' | 'lead_stage_changed' | 'job_booked'

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: '', label: 'All Actions' },
  { value: 'call_completed', label: '📞 Calls' },
  { value: 'quote_sent', label: '💰 Quotes Sent' },
  { value: 'sms_sent', label: '💬 Texts Sent' },
  { value: 'lead_created', label: '🟢 Leads Claimed' },
  { value: 'lead_stage_changed', label: '↗️ Stage Changes' },
  { value: 'job_booked', label: '🎉 Bookings' },
]

const BIG_EVENTS = new Set(['job_booked', 'quote_accepted'])

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-[10px] border px-4 py-3 text-center ${highlight && value > 0 ? 'border-[var(--app-accent)] bg-[rgba(15,106,83,0.06)]' : 'border-[var(--app-line)] bg-[var(--app-panel)]'}`}>
      <div className={`text-2xl font-bold ${highlight && value > 0 ? 'text-[var(--app-accent)]' : 'text-[var(--app-ink)]'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--app-muted)]">{label}</div>
    </div>
  )
}

function ActivityFeedContent() {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [repActivity, setRepActivity] = useState<RepActivity>({})
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(true)
  const [days, setDays] = useState<DaysFilter>(1)
  const [filterRep, setFilterRep] = useState('')
  const [filterType, setFilterType] = useState<TypeFilter>('')
  const [newCount, setNewCount] = useState(0)
  const lastTopId = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const fetchActivity = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(days), limit: '300' })
      if (filterRep) params.set('repId', filterRep)
      if (filterType) params.set('type', filterType)
      const res = await fetch(`/api/sales/activity?${params}`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { items: ActivityItem[]; summary: Summary; repActivity: RepActivity }
      setItems(data.items || [])
      setSummary(data.summary || null)
      setRepActivity(data.repActivity || {})
      // Track new items since last poll
      if (lastTopId.current && data.items.length > 0) {
        const topId = data.items[0]?.id
        if (topId !== lastTopId.current) {
          const idx = data.items.findIndex(i => i.id === lastTopId.current)
          setNewCount(idx > 0 ? idx : 0)
        }
      }
      if (data.items.length > 0) lastTopId.current = data.items[0].id
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [days, filterRep, filterType])

  useEffect(() => {
    void fetchActivity(true)
  }, [fetchActivity])

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => void fetchActivity(), POLL_MS)
    return () => clearInterval(id)
  }, [live, fetchActivity])

  // Build rep options from repActivity
  const repOptions = Object.entries(repActivity).map(([id, v]) => ({ value: id, label: v.name }))

  function scrollTop() { listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); setNewCount(0) }

  return (
    <div className="crm-shell space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-[var(--app-ink)]">Live Activity Feed</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Everything your team does — quotes, calls, texts, stage changes — in real time.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <button
            onClick={() => setLive(l => !l)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${live ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[var(--app-line)] text-[var(--app-muted)]'}`}
          >
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
          <button onClick={() => void fetchActivity(true)} className="crm-button">Refresh</button>
        </div>
      </div>

      {/* Today Stats */}
      {summary && (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-7">
          <StatCard label="Actions Today" value={summary.total} />
          <StatCard label="Calls" value={summary.calls} />
          <StatCard label="Texts Sent" value={summary.sms_sent} />
          <StatCard label="Quotes Sent" value={summary.quotes_sent} />
          <StatCard label="Stage Changes" value={summary.stage_changes} />
          <StatCard label="Leads Claimed" value={summary.leads_claimed} />
          <StatCard label="Bookings" value={summary.bookings} highlight />
        </div>
      )}

      {/* Rep Scorecards */}
      {Object.keys(repActivity).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(repActivity)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([id, rep]) => (
              <button
                key={id}
                onClick={() => setFilterRep(filterRep === id ? '' : id)}
                className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 text-left transition ${filterRep === id ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white' : 'border-[var(--app-line)] bg-[var(--app-panel)] hover:border-[var(--app-ink)]'}`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${filterRep === id ? 'bg-white/20 text-white' : 'bg-[var(--app-wash)] text-[var(--app-ink)]'}`}>
                  {rep.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className={`text-sm font-semibold ${filterRep === id ? 'text-white' : 'text-[var(--app-ink)]'}`}>{rep.name}</div>
                  <div className={`text-xs ${filterRep === id ? 'text-white/70' : 'text-[var(--app-muted)]'}`}>
                    {rep.count} action{rep.count !== 1 ? 's' : ''} today
                    {rep.types.call_completed ? ` · ${rep.types.call_completed} call${rep.types.call_completed !== 1 ? 's' : ''}` : ''}
                    {rep.types.quote_sent ? ` · ${rep.types.quote_sent} quote${rep.types.quote_sent !== 1 ? 's' : ''}` : ''}
                    {rep.types.sms_sent ? ` · ${rep.types.sms_sent} text${rep.types.sms_sent !== 1 ? 's' : ''}` : ''}
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
          {([1, 7, 30] as DaysFilter[]).map(d => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-[6px] px-3 py-1.5 text-xs font-semibold ${days === d ? 'bg-[var(--app-ink)] text-white' : 'text-[var(--app-muted)]'}`}>
              {d === 1 ? 'Today' : d === 7 ? '7 Days' : '30 Days'}
            </button>
          ))}
        </div>

        <select value={filterType} onChange={e => setFilterType(e.target.value as TypeFilter)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterType ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {repOptions.length > 0 && (
          <select value={filterRep} onChange={e => setFilterRep(e.target.value)} className={`crm-input h-9 w-auto cursor-pointer py-0 text-sm ${filterRep ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : ''}`}>
            <option value="">All Reps</option>
            {repOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}

        {(filterType || filterRep) && (
          <button onClick={() => { setFilterType(''); setFilterRep('') }} className="flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100">
            Clear filters ✕
          </button>
        )}

        <span className="ml-auto text-xs text-[var(--app-muted)]">{items.length} events</span>
      </div>

      {/* New items banner */}
      {newCount > 0 && (
        <button onClick={scrollTop} className="w-full rounded-[8px] border border-emerald-300 bg-emerald-50 py-2 text-center text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">
          ↑ {newCount} new action{newCount !== 1 ? 's' : ''} — click to scroll up
        </button>
      )}

      {/* Feed */}
      {loading ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading activity…</div>
      ) : items.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-5 py-16 text-center text-sm text-[var(--app-muted)]">
          No activity yet for this time range. Actions will appear here as your team works.
        </div>
      ) : (
        <div ref={listRef} className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] divide-y divide-[var(--app-line)] overflow-hidden max-h-[calc(100vh-420px)] overflow-y-auto">
          {items.map((item, idx) => {
            const isBig = BIG_EVENTS.has(item.type)
            const showDateDivider = idx === 0 ||
              new Date(items[idx - 1].ts).toDateString() !== new Date(item.ts).toDateString()

            return (
              <div key={item.id}>
                {showDateDivider && (
                  <div className="sticky top-0 z-10 bg-[var(--app-wash)] px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                    {new Date(item.ts).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                )}
                <div className={`flex items-start gap-4 px-5 py-3.5 transition hover:bg-[var(--app-bg)] ${isBig ? 'bg-[rgba(15,106,83,0.04)]' : ''}`}>
                  {/* Icon */}
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${isBig ? 'bg-emerald-100' : 'bg-[var(--app-wash)]'}`}>
                    {item.icon}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
                      {/* Rep name */}
                      <span className={`font-semibold ${isBig ? 'text-[var(--app-accent)]' : 'text-[var(--app-ink)]'}`}>
                        {item.repName === 'System' ? '🤖 System' : item.repName}
                      </span>
                      {/* Action */}
                      <span className="text-[var(--app-muted)]">{item.label}</span>
                      {/* Lead link */}
                      {item.leadName && item.leadId && (
                        <Link
                          href={`/sales/leads/${item.leadId}`}
                          onClick={e => e.stopPropagation()}
                          className="font-semibold text-[var(--app-ink)] underline decoration-[var(--app-line)] underline-offset-2 hover:text-[var(--app-accent)] hover:decoration-[var(--app-accent)]"
                        >
                          {item.leadName}
                        </Link>
                      )}
                      {/* Detail */}
                      {item.detail && (
                        <span className={`font-semibold ${isBig ? 'text-[var(--app-accent)]' : 'text-[var(--app-ink)]'}`}>
                          — {item.detail}
                        </span>
                      )}
                    </div>

                    {/* Sub-detail row */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-muted)]">
                      {prop(item,'origin_city') && prop(item,'dest_city') && (
                        <span>{prop(item,'origin_city')} → {prop(item,'dest_city')}</span>
                      )}
                      {prop(item,'lead_source') && (
                        <span className="capitalize">{prop(item,'lead_source').replace(/_/g, ' ')}</span>
                      )}
                      {item.type === 'lead_stage_changed' && prop(item,'days_in_stage') && (
                        <span>{prop(item,'days_in_stage')}d in prev stage</span>
                      )}
                      {item.type === 'call_completed' && prop(item,'move_readiness') && (
                        <span className={
                          prop(item,'move_readiness') === 'hot' ? 'text-rose-600 font-medium' :
                          prop(item,'move_readiness') === 'warm' ? 'text-amber-600 font-medium' :
                          'text-slate-500'
                        }>
                          {prop(item,'move_readiness')} lead
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Time */}
                  <span className="shrink-0 text-xs text-[var(--app-muted)]">{timeAgo(item.ts)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="crm-shell"><div className="crm-panel px-5 py-16 text-center text-sm text-[var(--app-muted)]">Loading activity feed…</div></div>}>
      <ActivityFeedContent />
    </Suspense>
  )
}
