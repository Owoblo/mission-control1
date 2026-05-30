'use client'

import { useEffect, useState } from 'react'
import { formatMoney } from '@/lib/sales'

interface RepStat {
  repId: string
  repName: string
  totalLeads: number
  bookedLeads: number
  lostLeads: number
  inProgress: number
  closeRate: number
  revenue: number
  avgDealSize: number
  avgDaysToClose: number | null
  avgTouchpoints: number | null
  avgResponseMins: number | null
  hotLeads: number
  topLostReasons: { reason: string; count: number }[]
  moveTypeCounts: Record<string, number>
}

function formatMins(mins: number | null) {
  if (mins === null) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function StatPill({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${accent || 'text-[#1a2744]'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--app-muted)]">{label}</div>
    </div>
  )
}

export default function RepsPage() {
  const [data, setData] = useState<{ reps: RepStat[]; totalLeads: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/sales/reps', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">Loading rep stats...</div></div>
  if (!data) return <div className="crm-shell"><div className="crm-panel p-16 text-center text-sm text-rose-500">Failed to load.</div></div>

  return (
    <div className="crm-shell space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1a2744]">Rep Performance</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Close rates, revenue, response time, and coaching signals per rep.</p>
      </div>

      <div className="space-y-6">
        {data.reps.map((rep, i) => (
          <div key={rep.repId} className="crm-panel overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--app-line)] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-white">
                  {rep.repName === 'Unassigned' ? '?' : rep.repName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div>
                  <div className="font-semibold text-[#1a2744]">{rep.repName}</div>
                  <div className="text-xs text-[var(--app-muted)]">{rep.totalLeads} leads total</div>
                </div>
                {i === 0 && data.reps.length > 1 && rep.repName !== 'Unassigned' && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Top Performer</span>
                )}
                {rep.hotLeads > 0 && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">🔥 {rep.hotLeads} Hot</span>
                )}
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-emerald-600">{formatMoney(rep.revenue)}</div>
                <div className="text-xs text-[var(--app-muted)]">total revenue</div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 divide-x divide-[var(--app-line)] border-b border-[var(--app-line)] md:grid-cols-6">
              <div className="p-4"><StatPill value={`${rep.closeRate}%`} label="Close Rate" accent={rep.closeRate >= 50 ? 'text-emerald-600' : rep.closeRate >= 30 ? 'text-amber-600' : 'text-rose-600'} /></div>
              <div className="p-4"><StatPill value={rep.bookedLeads} label="Booked" accent="text-emerald-600" /></div>
              <div className="p-4"><StatPill value={rep.lostLeads} label="Lost" accent={rep.lostLeads > 5 ? 'text-rose-600' : 'text-[#1a2744]'} /></div>
              <div className="p-4"><StatPill value={rep.avgDaysToClose !== null ? `${rep.avgDaysToClose}d` : '—'} label="Avg Days to Close" /></div>
              <div className="p-4"><StatPill value={rep.avgTouchpoints !== null ? rep.avgTouchpoints : '—'} label="Avg Touchpoints" /></div>
              <div className="p-4"><StatPill value={formatMins(rep.avgResponseMins)} label="Avg Response" accent={rep.avgResponseMins !== null && rep.avgResponseMins < 30 ? 'text-emerald-600' : rep.avgResponseMins !== null && rep.avgResponseMins > 120 ? 'text-rose-600' : 'text-[#1a2744]'} /></div>
            </div>

            {/* Bottom row */}
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              {/* Lost reasons */}
              {rep.topLostReasons.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Top Lost Reasons</div>
                  <div className="space-y-1">
                    {rep.topLostReasons.map(({ reason, count }) => (
                      <div key={reason} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-[var(--app-ink)]">{reason.replace(/_/g, ' ')}</span>
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">{count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Move type breakdown */}
              {Object.keys(rep.moveTypeCounts).length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Booked Move Types</div>
                  <div className="space-y-1">
                    {Object.entries(rep.moveTypeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-[var(--app-ink)]">{type.replace(/-/g, ' ')}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {data.reps.length === 0 && (
          <div className="crm-panel p-16 text-center text-sm text-[var(--app-muted)]">No rep data yet. Assign reps to leads to start tracking performance.</div>
        )}
      </div>
    </div>
  )
}
