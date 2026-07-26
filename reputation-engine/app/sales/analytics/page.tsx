'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatMoney } from '@/lib/sales'

type AnalyticsOption = {
  id: string
  label: string
}

type AnalyticsSnapshot = {
  appliedFilters: {
    range: 'week' | 'month' | 'ytd'
    rep?: string
    source?: string
    branch?: string
    dateFrom: string
    dateTo: string
  }
  totals: {
    leadsReceived: number
    confirmedBookings: number
    confirmedRevenue: number
    tentativeReservations: number
    lostLeads: number
    conversionRate: number
    averageQuoteValue: number
    followUpComplianceRate: number
    followUpCompliant: number
    followUpEligible: number
    monthlyTarget: number
    monthlyProgressPct: number
  }
  trend: Array<{
    label: string
    leads: number
    bookings: number
    revenue: number
  }>
  serviceBreakdown: Array<{
    category: string
    label: string
    quoteCount: number
    bookedCount: number
    quotedRevenue: number
    bookedRevenue: number
    conversionRate: number
  }>
  reservationFunnel: {
    total: number
    active: number
    converted: number
    released: number
    expired: number
    conversionRate: number
    reasons: Array<{ reason: string; label: string; count: number }>
  }
  sourceBreakdown: Array<{
    source: string
    label: string
    count: number
  }>
  lostReasons: Array<{
    reason: string
    label: string
    count: number
  }>
  activityBreakdown: Array<{
    type: string
    count: number
  }>
  branchBreakdown: Array<{
    branch: string
    label: string
    received: number
    booked: number
    lost: number
    conversionRate: number
  }>
  truckUtilizationDays: Array<{
    date: string
    branch: string
    status: 'ready' | 'unavailable'
    jobsBooked: number
    crewUsed: number
    crewCapacity: number
    crewPct: number
    trucksUsed: number
    truckCapacity: number
    truckPct: number
    trucksRemaining: number
    risk: 'low' | 'medium' | 'high' | 'unknown'
    note?: string
  }>
  filters: {
    repOptions: AnalyticsOption[]
    sourceOptions: AnalyticsOption[]
    branchOptions: AnalyticsOption[]
  }
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="crm-panel p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent || 'text-[#071421]'}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-[var(--app-muted)]">{sub}</div> : null}
    </div>
  )
}

function MiniBarRow({ label, value, total, tone = 'bg-[#071421]' }: { label: string; value: number; total: number; tone?: string }) {
  const pct = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 text-sm font-medium text-[#071421]">{label}</div>
      <div className="h-2 flex-1 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-14 text-right text-xs text-[var(--app-muted)]">{value}</div>
    </div>
  )
}

function TrendChart({ data, mode }: { data: AnalyticsSnapshot['trend']; mode: 'leads' | 'bookings' | 'revenue' }) {
  const max = Math.max(
    ...data.map(item => mode === 'revenue' ? item.revenue : mode === 'bookings' ? item.bookings : item.leads),
    1
  )

  return (
    <div className="flex h-40 items-end gap-2">
      {data.map(item => {
        const value = mode === 'revenue' ? item.revenue : mode === 'bookings' ? item.bookings : item.leads
        const height = `${Math.max(8, Math.round((value / max) * 100))}%`
        const tone = mode === 'revenue' ? 'bg-emerald-500' : mode === 'bookings' ? 'bg-[#C99700]' : 'bg-[#071421]'
        return (
          <div key={`${mode}-${item.label}`} className="flex flex-1 flex-col items-center gap-2">
            <div className="text-[10px] font-medium text-[var(--app-muted)]">
              {mode === 'revenue' ? (value > 0 ? `$${Math.round(value / 1000)}k` : '') : value || ''}
            </div>
            <div className="flex w-full items-end" style={{ height: 96 }}>
              <div className={`w-full rounded-t ${tone}`} style={{ height }} />
            </div>
            <div className="text-[10px] text-[var(--app-muted)]">{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<'week' | 'month' | 'ytd'>('month')
  const [rep, setRep] = useState('')
  const [source, setSource] = useState('')
  const [branch, setBranch] = useState('')
  const [data, setData] = useState<AnalyticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ range })
    if (rep) params.set('rep', rep)
    if (source) params.set('source', source)
    if (branch) params.set('branch', branch)
    return params.toString()
  }, [branch, range, rep, source])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/sales/analytics?${queryString}`, { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [queryString])

  if (loading) {
    return <div className="crm-shell"><h1 className="sr-only">Analytics</h1><div role="status" className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading analytics...</div></div>
  }

  if (!data) {
    return <div className="crm-shell"><h1 className="sr-only">Analytics</h1><div role="alert" className="crm-panel p-16 text-center text-sm text-rose-600">Failed to load analytics.</div></div>
  }

  const utilizationHighlights = data.truckUtilizationDays
    .filter(day => day.risk === 'high' || day.risk === 'medium')
    .slice(0, 8)
  const sourceTotal = data.sourceBreakdown.reduce((sum, item) => sum + item.count, 0)
  const lostTotal = data.lostReasons.reduce((sum, item) => sum + item.count, 0)
  const activityTotal = data.activityBreakdown.reduce((sum, item) => sum + item.count, 0)

  return (
    <div className="crm-shell space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#071421]">Analytics</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            Lead truth, booking pace, follow-up compliance, and next-30-day truck pressure.
          </p>
        </div>
        <a
          href={`/api/sales/analytics?${queryString}&format=csv`}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#071421] transition hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <div className="crm-panel p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Range</div>
            <select value={range} onChange={event => setRange(event.target.value as 'week' | 'month' | 'ytd')} className="crm-input w-full">
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="ytd">Year to Date</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Rep</div>
            <select value={rep} onChange={event => setRep(event.target.value)} className="crm-input w-full">
              <option value="">All reps</option>
              {data.filters.repOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Lead Source</div>
            <select value={source} onChange={event => setSource(event.target.value)} className="crm-input w-full">
              <option value="">All sources</option>
              {data.filters.sourceOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Branch</div>
            <select value={branch} onChange={event => setBranch(event.target.value)} className="crm-input w-full">
              <option value="">All branches</option>
              {data.filters.branchOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-[var(--app-muted)]">
          Window: {data.appliedFilters.dateFrom} to {data.appliedFilters.dateTo}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Leads Received" value={data.totals.leadsReceived.toLocaleString()} sub={`${data.totals.conversionRate}% conversion`} />
        <StatCard label="Confirmed Bookings" value={data.totals.confirmedBookings.toLocaleString()} sub={formatMoney(data.totals.confirmedRevenue)} accent="text-emerald-600" />
        <StatCard label="Tentative Reservations" value={data.totals.tentativeReservations.toLocaleString()} sub={`${data.totals.lostLeads} lost / declined`} accent="text-amber-600" />
        <StatCard
          label="Follow-Up Compliance"
          value={`${data.totals.followUpComplianceRate}%`}
          sub={`${data.totals.followUpCompliant}/${data.totals.followUpEligible} touched within 24h`}
          accent={data.totals.followUpComplianceRate >= 85 ? 'text-emerald-600' : data.totals.followUpComplianceRate >= 70 ? 'text-amber-600' : 'text-rose-600'}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Average Quote Value" value={data.totals.averageQuoteValue > 0 ? formatMoney(data.totals.averageQuoteValue) : '—'} />
        <StatCard label="Revenue Target" value={formatMoney(data.totals.monthlyTarget)} sub={`${data.totals.monthlyProgressPct}% of goal`} />
        <StatCard label="Source Mix" value={data.sourceBreakdown.length.toLocaleString()} sub="active lead sources in window" />
        <StatCard label="Activity Logged" value={activityTotal.toLocaleString()} sub="calls, emails, sms, notes" />
      </div>

      <div className="crm-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Revenue vs Target</div>
            <div className="mt-1 text-lg font-semibold text-[#071421]">{formatMoney(data.totals.confirmedRevenue)}</div>
          </div>
          <div className="text-sm font-semibold text-[var(--app-muted)]">{data.totals.monthlyProgressPct}%</div>
        </div>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div
            className={`h-3 rounded-full ${data.totals.monthlyProgressPct >= 100 ? 'bg-emerald-500' : data.totals.monthlyProgressPct >= 70 ? 'bg-[#C99700]' : 'bg-[#071421]'}`}
            style={{ width: `${Math.max(6, data.totals.monthlyProgressPct)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="crm-panel p-6 xl:col-span-2">
          <h2 className="font-semibold text-[#071421]">Lead and Booking Trend</h2>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <div>
              <div className="mb-3 text-sm font-medium text-[var(--app-muted)]">New leads</div>
              <TrendChart data={data.trend} mode="leads" />
            </div>
            <div>
              <div className="mb-3 text-sm font-medium text-[var(--app-muted)]">Bookings</div>
              <TrendChart data={data.trend} mode="bookings" />
            </div>
            <div>
              <div className="mb-3 text-sm font-medium text-[var(--app-muted)]">Booked revenue</div>
              <TrendChart data={data.trend} mode="revenue" />
            </div>
          </div>
        </div>

        <div className="crm-panel p-6">
          <h2 className="font-semibold text-[#071421]">Truck Utilization</h2>
          <p className="mt-1 text-xs text-[var(--app-muted)]">Next 30 days. Red means booked work is over branch capacity.</p>
          <div className="mt-4 space-y-3">
            {utilizationHighlights.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
                No truck or crew conflicts are forecast in the next 30 days.
              </div>
            ) : utilizationHighlights.map(day => (
              <div key={`${day.branch}-${day.date}`} className={`rounded-xl border px-3 py-3 ${day.risk === 'high' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[#071421]">{day.branch} · {day.date}</div>
                  <div className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${day.risk === 'high' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
                    {day.risk}
                  </div>
                </div>
                <div className="mt-2 text-xs text-[var(--app-muted)]">
                  {day.jobsBooked} jobs · trucks {day.trucksUsed}/{day.truckCapacity} · crew {day.crewUsed}/{day.crewCapacity}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.branchBreakdown.length > 0 && (
        <div className="crm-panel p-6">
          <h2 className="font-semibold text-[#071421]">Leads by City / Branch</h2>
          <p className="mt-1 text-xs text-[var(--app-muted)]">Received, booked, and lost in the selected window.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--app-line)]">
                  <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Branch</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Leads</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Booked</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Lost</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-line)]">
                {data.branchBreakdown.map(row => (
                  <tr key={row.branch}>
                    <td className="py-2.5 font-medium text-[var(--app-ink)]">{row.label}</td>
                    <td className="py-2.5 text-right text-[var(--app-ink)]">{row.received}</td>
                    <td className="py-2.5 text-right text-emerald-700 font-medium">{row.booked}</td>
                    <td className="py-2.5 text-right text-rose-600">{row.lost}</td>
                    <td className={`py-2.5 text-right font-semibold ${row.conversionRate >= 30 ? 'text-emerald-700' : row.conversionRate >= 15 ? 'text-amber-700' : 'text-rose-600'}`}>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="crm-panel p-6">
        <h2 className="font-semibold text-[#071421]">Service Mix</h2>
        <p className="mt-1 text-xs text-[var(--app-muted)]">Which parts of the customer journey are being quoted and booked. Revenue excludes HST.</p>
        <div className="mt-4 overflow-x-auto">
          {data.serviceBreakdown.length === 0 ? (
            <div className="text-sm text-[var(--app-muted)]">No quote service data in this window.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--app-line)]">
                  <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Service</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Quoted</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Booked</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Quoted value</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Booked value</th>
                  <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Conversion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--app-line)]">
                {data.serviceBreakdown.map(row => (
                  <tr key={row.category}>
                    <td className="py-2.5 font-medium text-[var(--app-ink)]">{row.label}</td>
                    <td className="py-2.5 text-right">{row.quoteCount}</td>
                    <td className="py-2.5 text-right">{row.bookedCount}</td>
                    <td className="py-2.5 text-right">{formatMoney(row.quotedRevenue)}</td>
                    <td className="py-2.5 text-right font-medium text-emerald-700">{formatMoney(row.bookedRevenue)}</td>
                    <td className={`py-2.5 text-right font-semibold ${row.conversionRate >= 30 ? 'text-emerald-700' : row.conversionRate >= 15 ? 'text-amber-700' : 'text-rose-600'}`}>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="crm-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[#071421]">Tentative Reservation Funnel</h2>
            <p className="mt-1 text-xs text-[var(--app-muted)]">Courtesy holds created in this window and what happened next.</p>
          </div>
          <div className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800">
            {data.reservationFunnel.conversionRate}% converted
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Created', data.reservationFunnel.total],
            ['Active', data.reservationFunnel.active],
            ['Booked', data.reservationFunnel.converted],
            ['Released', data.reservationFunnel.released],
            ['Expired', data.reservationFunnel.expired],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">{label}</div>
              <div className="mt-1 text-xl font-bold text-[var(--app-ink)]">{value}</div>
            </div>
          ))}
        </div>
        {data.reservationFunnel.reasons.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.reservationFunnel.reasons.map(item => (
              <span key={item.reason} className="rounded-full border border-[var(--app-line)] bg-white px-2.5 py-1 text-xs text-[var(--app-muted)]">
                {item.label} · {item.count}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="crm-panel p-6">
          <h2 className="font-semibold text-[#071421]">Lead Sources</h2>
          <div className="mt-4 space-y-3">
            {data.sourceBreakdown.length === 0 ? (
              <div className="text-sm text-[var(--app-muted)]">No source data in this window.</div>
            ) : data.sourceBreakdown.map(item => (
              <MiniBarRow key={item.source} label={item.label} value={item.count} total={sourceTotal} />
            ))}
          </div>
        </div>

        <div className="crm-panel p-6">
          <h2 className="font-semibold text-[#071421]">Lost / Declined Reasons</h2>
          <div className="mt-4 space-y-3">
            {data.lostReasons.length === 0 ? (
              <div className="text-sm text-[var(--app-muted)]">No lost leads recorded in this window.</div>
            ) : data.lostReasons.map(item => (
              <MiniBarRow key={item.reason} label={item.label} value={item.count} total={lostTotal} tone="bg-rose-400" />
            ))}
          </div>
        </div>

        <div className="crm-panel p-6">
          <h2 className="font-semibold text-[#071421]">Activity Breakdown</h2>
          <div className="mt-4 space-y-3">
            {data.activityBreakdown.length === 0 ? (
              <div className="text-sm text-[var(--app-muted)]">No follow-up activity recorded in this window.</div>
            ) : data.activityBreakdown.map(item => (
              <MiniBarRow key={item.type} label={item.type.replace(/_/g, ' ')} value={item.count} total={activityTotal} tone="bg-sky-400" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
