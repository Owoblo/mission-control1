'use client'

import { useEffect, useState } from 'react'
import { formatMoney } from '@/lib/sales'

interface AnalyticsData {
  totals: {
    leads: number
    leadsThisMonth: number
    quoted: number
    accepted: number
    conversionRate: number
    revenueQuoted: number
    revenueBooked: number
    revenueCollected: number
    bookedJobs: number
    bookedRevenue: number
  }
  stageCounts: Record<string, number>
  sourceCounts: Record<string, number>
  activityByType: Record<string, number>
  monthlyLeads: { month: string; count: number }[]
  monthlyRevenue: { month: string; amount: number }[]
  weeklyActivity: { week: string; count: number }[]
}

const SOURCE_LABELS: Record<string, string> = {
  phone: 'Phone', web: 'Website', facebook: 'Facebook', instagram: 'Instagram',
  referral: 'Referral', email: 'Email', other: 'Other',
}

const STAGE_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', estimate_scheduled: 'Est. Scheduled',
  estimate_done: 'Est. Done', pricing: 'Pricing', quoted: 'Quoted',
  shopping_around: 'Shopping', booked: 'Booked', lost: 'Lost',
}

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-slate-400', contacted: 'bg-sky-400', estimate_scheduled: 'bg-blue-400',
  estimate_done: 'bg-indigo-400', pricing: 'bg-purple-400', quoted: 'bg-amber-400',
  shopping_around: 'bg-orange-400', booked: 'bg-emerald-500', lost: 'bg-rose-400',
}

function shortMonth(m: string) {
  const [year, month] = m.split('-')
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-CA', { month: 'short' })
}

function BarChart({ data, valueKey, labelKey, color = 'bg-[#1a2744]', formatValue = String }: {
  data: Record<string, unknown>[]
  valueKey: string
  labelKey: string
  color?: string
  formatValue?: (v: number) => string
}) {
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1)
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0
        const pct = (val / max) * 100
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-[9px] text-[var(--app-muted)] font-medium">{val > 0 ? formatValue(val) : ''}</div>
            <div className="w-full flex items-end" style={{ height: 60 }}>
              <div
                className={`w-full rounded-t ${color} transition-all`}
                style={{ height: `${Math.max(pct, val > 0 ? 4 : 0)}%`, minHeight: val > 0 ? 3 : 0 }}
              />
            </div>
            <div className="text-[9px] text-[var(--app-muted)] text-center truncate w-full">{String(d[labelKey])}</div>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="crm-panel p-5">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--app-muted)]">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent || 'text-[#1a2744]'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--app-muted)]">{sub}</div>}
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sales/analytics', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading analytics...</div></div>
  if (!data) return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-rose-500">Failed to load analytics.</div></div>

  const { totals } = data
  const stageEntries = Object.entries(data.stageCounts).sort(([, a], [, b]) => b - a)
  const sourceEntries = Object.entries(data.sourceCounts).sort(([, a], [, b]) => b - a)
  const activityEntries = Object.entries(data.activityByType).sort(([, a], [, b]) => b - a)

  return (
    <div className="crm-shell space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1a2744]">Analytics</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Performance across leads, quotes, revenue, and activity.</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Leads" value={totals.leads.toLocaleString()} sub={`${totals.leadsThisMonth} this month`} />
        <StatCard label="Quotes Sent" value={totals.quoted.toLocaleString()} sub={`${totals.accepted} accepted`} />
        <StatCard label="Conversion Rate" value={`${totals.conversionRate}%`} sub="quotes → booked" accent={totals.conversionRate >= 50 ? 'text-emerald-600' : totals.conversionRate >= 30 ? 'text-amber-600' : 'text-rose-600'} />
        <StatCard label="Booked Jobs" value={totals.bookedJobs.toLocaleString()} sub={formatMoney(totals.bookedRevenue)} accent="text-emerald-600" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Revenue Quoted" value={formatMoney(totals.revenueQuoted)} sub="total pipeline value" />
        <StatCard label="Revenue Booked" value={formatMoney(totals.revenueBooked)} sub="accepted + invoiced" accent="text-[#1a2744]" />
        <StatCard label="Revenue Collected" value={formatMoney(totals.revenueCollected)} sub="deposits + balances paid" accent="text-emerald-600" />
        <StatCard label="Avg Booking Value" value={totals.bookedJobs > 0 ? formatMoney(Math.round(totals.bookedRevenue / totals.bookedJobs)) : '—'} sub="per booked job" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Monthly leads */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">New Leads by Month</h2>
          <BarChart
            data={data.monthlyLeads.map(d => ({ label: shortMonth(d.month), count: d.count }))}
            valueKey="count"
            labelKey="label"
          />
        </div>

        {/* Monthly revenue */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">Revenue Booked by Month</h2>
          <BarChart
            data={data.monthlyRevenue.map(d => ({ label: shortMonth(d.month), amount: d.amount }))}
            valueKey="amount"
            labelKey="label"
            color="bg-emerald-500"
            formatValue={v => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
          />
        </div>

        {/* Weekly activity */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">Weekly Activity (Last 8 Weeks)</h2>
          <BarChart
            data={data.weeklyActivity.map(d => ({ label: d.week.slice(5), count: d.count }))}
            valueKey="count"
            labelKey="label"
            color="bg-sky-400"
          />
        </div>

        {/* Lead sources */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">Lead Sources</h2>
          <div className="space-y-2">
            {sourceEntries.map(([source, count]) => {
              const pct = Math.round((count / totals.leads) * 100)
              return (
                <div key={source} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 text-sm font-medium text-[#1a2744]">{SOURCE_LABELS[source] ?? source}</div>
                  <div className="flex-1 rounded-full bg-slate-100 h-2">
                    <div className="h-2 rounded-full bg-[#1a2744]" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-16 text-right text-xs text-[var(--app-muted)]">{count} · {pct}%</div>
                </div>
              )
            })}
            {sourceEntries.length === 0 && <div className="text-sm text-[var(--app-muted)]">No source data yet.</div>}
          </div>
        </div>
      </div>

      {/* Pipeline + Activity breakdown */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Pipeline stages */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">Pipeline by Stage</h2>
          <div className="space-y-2">
            {stageEntries.map(([stage, count]) => {
              const pct = Math.round((count / totals.leads) * 100)
              const color = STAGE_COLORS[stage] ?? 'bg-slate-400'
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm font-medium text-[#1a2744]">{STAGE_LABELS[stage] ?? stage}</div>
                  <div className="flex-1 rounded-full bg-slate-100 h-2">
                    <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs text-[var(--app-muted)]">{count}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Activity breakdown */}
        <div className="crm-panel p-6">
          <h2 className="mb-4 font-semibold text-[#1a2744]">Activity Breakdown</h2>
          <div className="space-y-2">
            {activityEntries.length === 0 && <div className="text-sm text-[var(--app-muted)]">No activity logged yet.</div>}
            {activityEntries.map(([type, count]) => {
              const total = Object.values(data.activityByType).reduce((a, b) => a + b, 0)
              const pct = Math.round((count / total) * 100)
              return (
                <div key={type} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm font-medium capitalize text-[#1a2744]">{type.replace(/_/g, ' ')}</div>
                  <div className="flex-1 rounded-full bg-slate-100 h-2">
                    <div className="h-2 rounded-full bg-[#f5a623]" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs text-[var(--app-muted)]">{count}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
