'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

interface Stats {
  stageCounts: Record<string, number>
  tierCounts: Record<string, number>
  activePartners: number
  totalContacts: number
  signals: { id: string; signal_type: string; company: string; city: string; status: string }[]
  campaigns: { id: string; name: string; tracking_code: string; letters_sent: number; responses: number; bookings: number; revenue_cents: number; sent_date: string }[]
}

const STAGE_LABELS: Record<string, { label: string; color: string }> = {
  cold:      { label: 'Cold',      color: 'bg-slate-100 text-slate-600' },
  contacted: { label: 'Contacted', color: 'bg-sky-100 text-sky-700' },
  engaged:   { label: 'Engaged',   color: 'bg-amber-100 text-amber-700' },
  qualified: { label: 'Qualified', color: 'bg-orange-100 text-orange-700' },
  partnered: { label: 'Partnered', color: 'bg-emerald-100 text-emerald-700' },
  referring: { label: 'Referring', color: 'bg-green-600 text-white' },
  revisit:   { label: 'Revisit',   color: 'bg-purple-100 text-purple-700' },
  dnc:       { label: 'DNC',       color: 'bg-red-100 text-red-600' },
}

const SIGNAL_URGENCY: Record<string, string> = {
  'NEW PLANT': 'bg-red-100 text-red-700',
  'EV BATTERY PLANT': 'bg-rose-100 text-rose-700',
  'EXPANSION': 'bg-amber-100 text-amber-700',
  'HIRING': 'bg-yellow-100 text-yellow-700',
}

export default function MarketingPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/marketing/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .finally(() => setLoading(false))
  }, [])

  const pipelineStages = ['cold', 'contacted', 'engaged', 'qualified', 'partnered', 'referring']

  return (
    <div className="crm-shell space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Market Engine</h1>
          <p className="mt-1 text-sm text-slate-500">
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="crm-panel p-16 text-center text-sm text-slate-400">Loading market data...</div>
      ) : !stats ? null : (
        <>
          {/* Top stats */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Total Contacts" value={stats.totalContacts.toLocaleString()} sub="in database" color="#1a2744" />
            <StatCard label="Active Partners" value={stats.activePartners} sub="partnered or referring" color="#16a34a" />
            <StatCard label="Engaged" value={(stats.stageCounts.engaged ?? 0) + (stats.stageCounts.qualified ?? 0)} sub="warm leads" color="#d97706" />
            <StatCard label="Open Signals" value={stats.signals.filter(s => s.status === 'new').length} sub="unactioned" color="#dc2626" />
          </div>

          {/* Pipeline funnel */}
          <div className="crm-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-[#1a2744]">Partner Pipeline</h2>
              <Link href="/marketing/partners" className="text-xs font-medium text-[#1a2744] underline underline-offset-2">Manage →</Link>
            </div>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {pipelineStages.map(stage => {
                const meta = STAGE_LABELS[stage]
                const count = stats.stageCounts[stage] ?? 0
                return (
                  <Link key={stage} href={`/marketing/partners?stage=${stage}`} className="group flex flex-col items-center gap-2 rounded-xl border border-slate-100 p-4 hover:border-[#1a2744]/30 transition">
                    <div className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.color}`}>{meta.label}</div>
                    <div className="text-2xl font-bold text-[#1a2744]">{count.toLocaleString()}</div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Tier breakdown */}
          <div className="crm-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-[#1a2744]">Contact Pool by Tier</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {['A','B','C','D','E'].map(tier => {
                const descs: Record<string, string> = {
                  A: 'Lawyers & Brokers',
                  B: 'Builders & Insurance',
                  C: 'Corporate & Employers',
                  D: 'Community & Churches',
                  E: 'Care Facilities',
                }
                return (
                  <Link key={tier} href={`/marketing/partners?tier=${tier}`} className="flex flex-col gap-1 rounded-xl border border-slate-100 p-4 hover:border-[#1a2744]/30 transition">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a2744] text-xs font-bold text-[#f5a623]">
                        {tier}
                      </span>
                      <span className="text-xl font-bold text-[#1a2744]">{(stats.tierCounts[tier] ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-slate-500">{descs[tier]}</div>
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Two columns: Signals + Campaigns */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Hot signals */}
            <div className="crm-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-[#1a2744]">Hot Signals</h2>
                <Link href="/marketing/signals" className="text-xs font-medium text-[#1a2744] underline underline-offset-2">All signals →</Link>
              </div>
              <div className="space-y-3">
                {stats.signals.length === 0 ? (
                  <p className="text-sm text-slate-400">No signals yet.</p>
                ) : stats.signals.map(s => (
                  <div key={s.id} className="flex items-start gap-3 rounded-xl border border-slate-100 p-3">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SIGNAL_URGENCY[s.signal_type] ?? 'bg-slate-100 text-slate-600'}`}>
                      {s.signal_type}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#1a2744]">{s.company}</div>
                      <div className="text-xs text-slate-400">{s.city}</div>
                    </div>
                    {s.status === 'actioned' && <span className="ml-auto shrink-0 text-xs text-emerald-600">✓</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Campaigns */}
            <div className="crm-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-[#1a2744]">Direct Mail ROI</h2>
                <Link href="/marketing/campaigns" className="text-xs font-medium text-[#1a2744] underline underline-offset-2">All campaigns →</Link>
              </div>
              {stats.campaigns.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-400 mb-4">No campaigns logged yet.</p>
                  <Link href="/marketing/campaigns" className="block rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-sm text-slate-400 hover:border-[#1a2744]/30 transition">
                    + Log your first direct mail batch
                  </Link>
                </div>
              ) : stats.campaigns.map(c => {
                const roi = c.revenue_cents > 0 && c.letters_sent > 0
                  ? (((c.revenue_cents / 100) - (c.letters_sent * 2)) / (c.letters_sent * 2) * 100).toFixed(0)
                  : null
                return (
                  <div key={c.id} className="rounded-xl border border-slate-100 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#1a2744]">{c.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{c.tracking_code}</span>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500">
                      <span>{c.letters_sent} letters</span>
                      <span>{c.responses} responses</span>
                      <span>{c.bookings} bookings</span>
                      {roi && <span className="font-bold text-emerald-700">{roi}% ROI</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { href: '/marketing/partners?stage=cold', label: 'Work Cold List', icon: '❄️', desc: `${stats.stageCounts.cold ?? 0} contacts ready` },
              { href: '/marketing/partners?stage=contacted', label: 'Follow Up', icon: '📞', desc: `${stats.stageCounts.contacted ?? 0} awaiting reply` },
              { href: '/marketing/campaigns', label: 'Log Mail Batch', icon: '✉️', desc: 'Track ROI by code' },
              { href: '/marketing/signals', label: 'Check Signals', icon: '📡', desc: `${stats.signals.filter(s => s.status === 'new').length} new opportunities` },
            ].map(item => (
              <Link key={item.href} href={item.href} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-5 hover:border-[#1a2744]/30 hover:shadow-sm transition">
                <span className="text-2xl">{item.icon}</span>
                <div className="font-semibold text-sm text-[#1a2744]">{item.label}</div>
                <div className="text-xs text-slate-400">{item.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub: string; color: string }) {
  return (
    <div className="crm-panel p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-bold" style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{sub}</div>
    </div>
  )
}
