'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { PARTNERSHIP_STAGE_META } from '@/lib/marketing'

interface Stats {
  stageCounts: Record<string, number>
  tierCounts: Record<string, number>
  activePartners: number
  totalContacts: number
  followUpDue: number
  corporateCount: number
  signals: { id: string; signal_type: string; company: string; city: string; status: string }[]
  campaigns: { id: string; name: string; tracking_code: string; letters_sent: number; responses: number; bookings: number; revenue_cents: number; sent_date: string }[]
}

const SIGNAL_META: Record<string, string> = {
  'NEW PLANT': 'bg-rose-100 text-rose-700',
  'EV BATTERY PLANT': 'bg-red-100 text-red-700',
  EXPANSION: 'bg-amber-100 text-amber-700',
  HIRING: 'bg-yellow-100 text-yellow-700',
  RELOCATION: 'bg-sky-100 text-sky-700',
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

  const pipelineStages = useMemo(() => ([
    'target',
    'mail_sent',
    'follow_up_due',
    'attempting_contact',
    'connected',
    'qualified',
    'partnership_active',
  ]), [])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-[var(--app-line)] bg-[linear-gradient(135deg,#10213d_0%,#173057_55%,#f3f0e8_180%)]">
        <div className="grid gap-8 px-6 py-7 md:grid-cols-[1.6fr,1fr] md:px-8">
          <div className="space-y-4">
            <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/75">
              Partnerships OS
            </div>
            <div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Run partner outreach, corporate prospecting, and signal response from one system.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                Your rep should not be guessing who to call next. This board makes mail follow-up, relationship tracking, and rapid signal response visible in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/marketing/partners?focus=due" className="rounded-xl bg-[#f5a623] px-4 py-2.5 text-sm font-semibold text-[#142849] transition hover:brightness-95">
                Work Due Follow-Ups
              </Link>
              <Link href="/marketing/queue" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15">
                Open Daily Queue
              </Link>
              <Link href="/marketing/signals" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15">
                Review Signals
              </Link>
            </div>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/10 bg-white/10 p-4 backdrop-blur">
            <Kpi label="Follow-Ups Due" value={stats?.followUpDue ?? '—'} tone="text-rose-200" />
            <Kpi label="Active Partnerships" value={stats?.activePartners ?? '—'} tone="text-emerald-200" />
            <Kpi label="Corporate Targets" value={stats?.corporateCount ?? '—'} tone="text-sky-200" />
            <Kpi label="Open Signals" value={stats ? stats.signals.filter(signal => signal.status === 'new').length : '—'} tone="text-amber-200" />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-16 text-center text-sm text-slate-500">Loading partnerships overview...</div>
      ) : !stats ? null : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <StatCard label="Total Accounts" value={stats.totalContacts.toLocaleString()} hint="partner + corporate targets" accent="bg-[#1a2744]" />
            <StatCard label="Mail Sent Pool" value={(stats.stageCounts.mail_sent ?? 0).toLocaleString()} hint="waiting for timed follow-up" accent="bg-amber-500" />
            <StatCard label="Connected" value={((stats.stageCounts.connected ?? 0) + (stats.stageCounts.qualified ?? 0)).toLocaleString()} hint="real conversations in motion" accent="bg-violet-500" />
            <StatCard label="Active Partnerships" value={(stats.stageCounts.partnership_active ?? 0).toLocaleString()} hint="referral / relocation relationships" accent="bg-emerald-500" />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.25fr,0.9fr]">
            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Pipeline Health</h2>
                  <p className="text-sm text-slate-500">Use this to see whether mailed contacts are actually converting into conversations and partnerships.</p>
                </div>
                <Link href="/marketing/partners" className="text-sm font-medium text-[#1a2744] underline underline-offset-4">
                  Open Workspace
                </Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {pipelineStages.map(stage => {
                  const meta = PARTNERSHIP_STAGE_META[stage as keyof typeof PARTNERSHIP_STAGE_META]
                  const count = stats.stageCounts[stage] ?? 0
                  return (
                    <Link
                      key={stage}
                      href={`/marketing/partners?stage=${stage}`}
                      className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 transition hover:border-[#1a2744]/25 hover:bg-white"
                    >
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.color}`}>
                        {meta.shortLabel}
                      </span>
                      <div className="mt-4 text-3xl font-semibold tracking-tight text-[#1a2744]">{count.toLocaleString()}</div>
                      <div className="mt-1 text-xs text-slate-500">{meta.label}</div>
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Immediate Work</h2>
                  <p className="text-sm text-slate-500">The rep should be able to step into one of these queues without asking you what to do.</p>
                </div>
              </div>
              <div className="space-y-3">
                <ActionLink href="/marketing/partners?focus=due" title="Follow-Up Due Now" desc={`${stats.followUpDue} accounts need a call, postcard, or check-in now.`} />
                <ActionLink href="/marketing/partners?pipeline=partners&stage=mail_sent" title="Three-Week Mail Follow-Up" desc={`${stats.stageCounts.mail_sent ?? 0} mailed partner targets waiting for the 21-day follow-up cycle.`} />
                <ActionLink href="/marketing/partners?pipeline=corporate" title="Corporate Prospecting" desc={`${stats.corporateCount} corporate / institutional accounts available for relocation and bigger-move outreach.`} />
                <ActionLink href="/marketing/signals" title="Fast Signal Response" desc={`${stats.signals.filter(signal => signal.status === 'new').length} fresh signals should be actioned the same day.`} />
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1fr,1fr]">
            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Signal Intake</h2>
                  <p className="text-sm text-slate-500">Signals should feed the outreach system, not live in a separate universe.</p>
                </div>
                <Link href="/marketing/signals" className="text-sm font-medium text-[#1a2744] underline underline-offset-4">
                  All Signals
                </Link>
              </div>
              <div className="space-y-3">
                {stats.signals.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No signals logged yet.</div>
                ) : stats.signals.map(signal => (
                  <div key={signal.id} className="flex items-start gap-3 rounded-[18px] border border-slate-200 p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${SIGNAL_META[signal.signal_type] ?? 'bg-slate-100 text-slate-700'}`}>
                      {signal.signal_type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[#1a2744]">{signal.company}</div>
                      <div className="text-xs text-slate-500">{signal.city}</div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${signal.status === 'new' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                      {signal.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-[#1a2744]">Recent Campaigns</h2>
                  <p className="text-sm text-slate-500">Track direct-mail performance beside follow-up work so outreach stays accountable.</p>
                </div>
                <Link href="/marketing/campaigns" className="text-sm font-medium text-[#1a2744] underline underline-offset-4">
                  Campaigns
                </Link>
              </div>
              <div className="space-y-3">
                {stats.campaigns.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No campaign batches logged yet.</div>
                ) : stats.campaigns.map(campaign => (
                  <div key={campaign.id} className="rounded-[18px] border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[#1a2744]">{campaign.name}</div>
                        <div className="text-xs text-slate-500">{campaign.sent_date}</div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{campaign.tracking_code}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>{campaign.letters_sent} letters</span>
                      <span>{campaign.responses} responses</span>
                      <span>{campaign.bookings} bookings</span>
                      <span className="font-semibold text-emerald-700">${(campaign.revenue_cents / 100).toLocaleString()}</span>
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

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="rounded-[24px] border border-[var(--app-line)] bg-white p-5">
      <div className={`mb-4 h-1.5 w-12 rounded-full ${accent}`} />
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-4xl font-semibold tracking-tight text-[#1a2744]">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{hint}</div>
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
