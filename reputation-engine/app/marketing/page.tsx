'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { PARTNERSHIP_STAGE_META } from '@/lib/marketing'

interface StageStats {
  stageCounts: Record<string, number>
  tierCounts: Record<string, number>
  activePartners: number
  totalContacts: number
  followUpDue: number
  corporateCount: number
  signals: { id: string; signal_type: string; company: string; city: string; status: string }[]
}

interface BatchCard {
  id: string
  name: string
  industry: string | null
  city: string | null
  status: string
  sequence_type: string
  mail_sent_date: string | null
  email_delay_days: number
  sms_delay_days: number
  rep_name: string
  partnership_phone: string
  tracking_code: string | null
  notes: string | null
  created_at: string
  total_contacts: number
  responded_count: number
  engaged_count: number
  partner_count: number
}

function fmtDate(value?: string | null) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

function countStatus(batches: BatchCard[], status: string) {
  return batches.filter(batch => batch.status === status).length
}

export default function MarketingPage() {
  const [stats, setStats] = useState<StageStats | null>(null)
  const [batches, setBatches] = useState<BatchCard[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'draft'>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/marketing/stats', { credentials: 'include' }),
      fetch('/api/marketing/batches', { credentials: 'include' }),
    ])
      .then(async ([statsRes, batchesRes]) => ({
        stats: statsRes.ok ? await statsRes.json() : null,
        batches: batchesRes.ok ? await batchesRes.json() : [],
      }))
      .then(({ stats, batches }) => {
        setStats(stats)
        setBatches(batches)
      })
      .finally(() => setLoading(false))
  }, [])

  const visibleBatches = useMemo(() => {
    if (statusFilter === 'all') return batches
    return batches.filter(batch => batch.status === statusFilter)
  }, [batches, statusFilter])

  const totalBatches = batches.length
  const activeNow = countStatus(batches, 'active')
  const totalResponded = batches.reduce((sum, batch) => sum + (batch.responded_count ?? 0), 0)
  const newPartners = batches.reduce((sum, batch) => sum + (batch.partner_count ?? 0), 0)

  const stageFlow = [
    { key: 'target', label: 'Target', count: stats?.stageCounts.target ?? 0, tone: 'bg-slate-100 text-slate-700' },
    { key: 'mail_sent', label: 'Mailed', count: stats?.stageCounts.mail_sent ?? 0, tone: 'bg-amber-100 text-amber-800' },
    { key: 'follow_up_due', label: 'Due', count: stats?.stageCounts.follow_up_due ?? 0, tone: 'bg-rose-100 text-rose-700' },
    { key: 'connected', label: 'Connected', count: stats?.stageCounts.connected ?? 0, tone: 'bg-violet-100 text-violet-700' },
    { key: 'qualified', label: 'Qualified', count: stats?.stageCounts.qualified ?? 0, tone: 'bg-orange-100 text-orange-700' },
    { key: 'partnership_active', label: 'Active', count: stats?.stageCounts.partnership_active ?? 0, tone: 'bg-emerald-100 text-emerald-700' },
  ]

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-[var(--app-line)] bg-[linear-gradient(135deg,#0c1830_0%,#173057_52%,#f3f0e8_170%)]">
        <div className="grid gap-8 px-6 py-7 md:grid-cols-[1.55fr,1fr] md:px-8">
          <div className="space-y-4">
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/75">
              Outreach Campaigns
            </div>
            <div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Batch tracker for mailed partnerships, live replies, and stage movement.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                Track each batch from target list to active partnership. The workspace keeps mail volume, response flow, and rep handoff visible in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/marketing/partners?tab=batches" className="rounded-xl bg-[#f5a623] px-4 py-2.5 text-sm font-semibold text-[#142849] transition hover:brightness-95">
                Open Batch Manager
              </Link>
              <Link href="/marketing/partners?focus=due" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15">
                Work Due Follow-Ups
              </Link>
              <Link href="/marketing/partners?tab=pipeline" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15">
                Review Pipeline
              </Link>
            </div>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
            <Kpi label="Total Batches" value={loading ? '—' : totalBatches} tone="text-white" />
            <Kpi label="Active Now" value={loading ? '—' : activeNow} tone="text-emerald-200" />
            <Kpi label="Total Responded" value={loading ? '—' : totalResponded} tone="text-cyan-200" />
            <Kpi label="New Partners" value={loading ? '—' : newPartners} tone="text-amber-200" />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-16 text-center text-sm text-slate-500">
          Loading batch tracker...
        </div>
      ) : !stats ? null : (
        <>
          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {stageFlow.map(stage => (
              <div key={stage.key} className="rounded-[24px] border border-[var(--app-line)] bg-white p-5">
                <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${stage.tone}`}>{stage.label}</div>
                <div className="mt-4 text-3xl font-semibold tracking-tight text-[#1a2744]">{stage.count.toLocaleString()}</div>
                <div className="mt-1 text-xs text-slate-500">Contacts in this stage</div>
              </div>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.35fr,0.95fr]">
            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Batch Tracker</h2>
                  <p className="text-sm text-slate-500">Each card represents a live mailed batch and shows the stage movement behind it.</p>
                </div>
                <div className="flex items-center gap-2">
                  {(['all', 'active', 'completed', 'draft'] as const).map(status => (
                    <button
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                        statusFilter === status
                          ? 'border-[#1a2744] bg-[#1a2744] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                      }`}
                    >
                      {status === 'all' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {visibleBatches.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 lg:col-span-2">
                    No batches match this filter.
                  </div>
                ) : visibleBatches.map(batch => {
                  const completion = batch.total_contacts > 0
                    ? Math.min(100, Math.round((batch.partner_count / batch.total_contacts) * 100))
                    : 0
                  const statusTone = batch.status === 'active'
                    ? 'bg-emerald-100 text-emerald-700'
                    : batch.status === 'completed'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-amber-100 text-amber-700'

                  return (
                    <Link
                      key={batch.id}
                      href="/marketing/partners?tab=batches"
                      className="rounded-[24px] border border-slate-200 bg-white p-5 transition hover:border-[#1a2744]/25 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusTone}`}>
                            {batch.status}
                          </span>
                          <div className="mt-3 text-[22px] font-semibold tracking-tight text-[#1a2744] leading-tight">
                            {batch.name}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                          {batch.tracking_code ?? 'Batch'}
                        </span>
                      </div>

                      <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                        <div className="flex items-center gap-2">
                          <span>🏷️</span>
                          <span>{batch.industry ?? 'Partnership'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>📍</span>
                          <span>{batch.city ?? '—'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>📬</span>
                          <span>Sent: {fmtDate(batch.mail_sent_date)}</span>
                        </div>
                      </div>

                      <div className="mt-5 rounded-[18px] border border-slate-100 bg-slate-50 p-4">
                        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                          <span>Stage progression</span>
                          <span>{completion}% to active</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200">
                          <div className="h-2 rounded-full bg-[#1a2744]" style={{ width: `${completion}%` }} />
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                        <Metric value={batch.responded_count} label="Responded" tone="text-[#1a2744]" />
                        <Metric value={batch.engaged_count} label="Engaged" tone="text-violet-600" />
                        <Metric value={batch.partner_count} label="Partners" tone="text-emerald-600" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Immediate Work</h2>
                  <p className="text-sm text-slate-500">The rep should step into one of these queues without needing extra direction.</p>
                </div>
                <div className="space-y-3">
                  <ActionLink
                    href="/marketing/partners?focus=due"
                    title="Follow-Up Due Now"
                    desc={`${stats.followUpDue} accounts need a call, email, or check-in now.`}
                  />
                  <ActionLink
                    href="/marketing/partners?tab=batches"
                    title="Windsor Realtors - Batch 1"
                    desc="The current mailed batch is live and ready for response tracking."
                  />
                  <ActionLink
                    href="/marketing/partners?tab=pipeline"
                    title="Responded Contacts"
                    desc={`${stats.stageCounts.connected ?? 0} connected contacts are ready for human follow-up.`}
                  />
                  <ActionLink
                    href="/marketing/signals"
                    title="Fast Signal Response"
                    desc={`${stats.signals.filter(signal => signal.status === 'new').length} fresh signals should be actioned the same day.`}
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Signal Intake</h2>
                  <p className="text-sm text-slate-500">Signals should feed outreach, not live in a separate universe.</p>
                </div>
                <div className="space-y-3">
                  {stats.signals.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                      No signals logged yet.
                    </div>
                  ) : stats.signals.map(signal => (
                    <div key={signal.id} className="flex items-start gap-3 rounded-[18px] border border-slate-200 p-4">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                        signal.signal_type === 'NEW PLANT'
                          ? 'bg-rose-100 text-rose-700'
                          : signal.signal_type === 'EV BATTERY PLANT'
                            ? 'bg-red-100 text-red-700'
                            : signal.signal_type === 'EXPANSION'
                              ? 'bg-amber-100 text-amber-700'
                              : signal.signal_type === 'HIRING'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-sky-100 text-sky-700'
                      }`}>
                        {signal.signal_type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[#1a2744]">{signal.company}</div>
                        <div className="text-xs text-slate-500">{signal.city}</div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        signal.status === 'new' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {signal.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr,1fr]">
            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Stage Flow</h2>
                  <p className="text-sm text-slate-500">This is the live movement from target to active partnership.</p>
                </div>
                <Link href="/marketing/partners" className="text-sm font-medium text-[#1a2744] underline underline-offset-4">
                  Open Workspace
                </Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {stageFlow.map(stage => {
                  const meta = PARTNERSHIP_STAGE_META[stage.key as keyof typeof PARTNERSHIP_STAGE_META]
                  return (
                    <div key={stage.key} className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.color}`}>
                        {meta.shortLabel}
                      </span>
                      <div className="mt-4 text-3xl font-semibold tracking-tight text-[#1a2744]">{stage.count.toLocaleString()}</div>
                      <div className="mt-1 text-xs text-slate-500">{meta.label}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Recent Batches</h2>
                  <p className="text-sm text-slate-500">Track direct mail batches beside follow-up work so outreach stays accountable.</p>
                </div>
                <Link href="/marketing/partners?tab=batches" className="text-sm font-medium text-[#1a2744] underline underline-offset-4">
                  Batch Manager
                </Link>
              </div>
              <div className="space-y-3">
                {batches.slice(0, 5).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                    No campaign batches logged yet.
                  </div>
                ) : batches.slice(0, 5).map(batch => (
                  <div key={batch.id} className="rounded-[18px] border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#1a2744]">{batch.name}</div>
                        <div className="text-xs text-slate-500">{fmtDate(batch.mail_sent_date)}</div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                        {batch.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>{batch.total_contacts} contacts</span>
                      <span>{batch.responded_count} responded</span>
                      <span>{batch.partner_count} partners</span>
                      <span className="font-semibold text-emerald-700">{batch.city ?? '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/10 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-[14px] border border-slate-100 bg-slate-50 p-3">
      <div className={`text-lg font-semibold tracking-tight ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
    </div>
  )
}

function ActionLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block rounded-[18px] border border-slate-200 bg-slate-50/70 p-4 transition hover:border-[#1a2744]/25 hover:bg-white">
      <div className="text-sm font-semibold text-[#1a2744]">{title}</div>
      <div className="mt-1 text-sm leading-6 text-slate-500">{desc}</div>
    </Link>
  )
}
