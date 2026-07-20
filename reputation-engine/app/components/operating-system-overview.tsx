'use client'

import Link from 'next/link'
import { deriveJobReadiness, deriveOperatingExceptions, deriveOperatingStage, OPERATING_STAGE_META } from '@/lib/job-spine'
import { formatMoney } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

type Props = {
  leads: CRMLead[]
  quotes: CRMQuote[]
  loading: boolean
}

function localDateStamp(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return value.toLocaleDateString('en-CA')
}

function moveDate(lead: CRMLead, quote?: CRMQuote | null) {
  return lead.moveDate || quote?.moveDate
}

function routeLabel(lead: CRMLead, quote?: CRMQuote | null) {
  const origin = lead.originCity || quote?.originCity || 'Origin TBD'
  const destination = lead.destCity || quote?.destCity || 'Destination TBD'
  return `${origin} → ${destination}`
}

function latestExecution(lead: CRMLead) {
  return (lead.moveExecutionLog?.entries || [])
    .filter(entry => entry.timestamp)
    .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))[0]
}

function statusTone(stage: ReturnType<typeof deriveOperatingStage>) {
  if (['completed', 'paid', 'reviewed', 'closed'].includes(stage)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['booked', 'confirmed', 'prepared'].includes(stage)) return 'border-blue-200 bg-blue-50 text-blue-800'
  if (['dispatched', 'in_progress'].includes(stage)) return 'border-amber-300 bg-amber-50 text-amber-900'
  return 'border-[var(--app-line)] bg-white text-[#344054]'
}

export function OperatingSystemOverview({ leads, quotes, loading }: Props) {
  const quoteById = new Map(quotes.map(item => [item.id, item]))
  const quoteFor = (lead: CRMLead) => lead.quoteId ? quoteById.get(lead.quoteId) || null : null
  const today = localDateStamp()
  const tomorrow = localDateStamp(1)
  const exceptions = leads.flatMap(lead => deriveOperatingExceptions(lead, quoteFor(lead)))
    .sort((left, right) => (left.severity === right.severity ? left.customer.localeCompare(right.customer) : left.severity === 'urgent' ? -1 : 1))
  const liveJobs = leads.filter(lead => {
    const stage = deriveOperatingStage(lead, quoteFor(lead))
    return stage === 'dispatched' || stage === 'in_progress' || (moveDate(lead, quoteFor(lead)) === today && lead.stage === 'booked')
  })
  const todayJobs = leads.filter(lead => moveDate(lead, quoteFor(lead)) === today || moveDate(lead, quoteFor(lead)) === tomorrow)
  const todayEstimates = leads.filter(lead => lead.estimateDate === today || lead.followUpDate === today)
  const active = leads.filter(lead => !['completed', 'customer_success', 'lost'].includes(lead.stage))
  const spineOrder = ['lead', 'qualified', 'estimate', 'quote', 'booked', 'confirmed', 'prepared', 'dispatched', 'in_progress'] as const
  const stageCounts = spineOrder.map(stage => ({ stage, count: active.filter(lead => deriveOperatingStage(lead, quoteFor(lead)) === stage).length }))
  const bookedQuotes = quotes.filter(item => Boolean(item.acceptedAt || item.depositPaidAt))
  const completedLeads = leads.filter(lead => ['completed', 'customer_success'].includes(lead.stage))
  const completedRevenue = completedLeads.reduce((sum, lead) => sum + Number(quoteFor(lead)?.total || 0), 0)
  const bookedRevenue = bookedQuotes.reduce((sum, quote) => sum + Number(quote.total || 0), 0)
  const won = leads.filter(lead => ['booked', 'completed', 'customer_success'].includes(lead.stage)).length
  const decided = won + leads.filter(lead => lead.stage === 'lost').length
  const conversion = decided ? Math.round((won / decided) * 100) : 0
  const sevenDays = new Date(); sevenDays.setDate(sevenDays.getDate() + 7)
  const nextSevenJobs = leads.filter(lead => {
    const date = moveDate(lead, quoteFor(lead))
    return date && new Date(`${date}T12:00:00`) >= new Date(`${today}T00:00:00`) && new Date(`${date}T12:00:00`) <= sevenDays
  })
  const atRiskNextSeven = nextSevenJobs.filter(lead => deriveJobReadiness(lead, quoteFor(lead)).status !== 'fully_ready').length

  return (
    <section className="space-y-8 border-b border-[var(--app-line)] pb-10">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a6800]">Saturn Star operating system</div>
          <h1 className="mt-2 font-display text-[2rem] font-semibold tracking-tight text-[#071421] md:text-[34px]">What is happening, and what needs intervention?</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">One operational view from incoming demand to prepared jobs, live execution and final care.</p>
        </div>
        <div className="flex gap-2"><Link href="/sales/new" className="crm-button-dark">Capture demand</Link><Link href="/sales/operations" className="crm-button">Open operations</Link></div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div className="space-y-8">
          <section>
            <div className="flex items-baseline justify-between border-b border-[var(--app-line)] pb-3"><div><h2 className="text-xl font-semibold text-[#071421]">Now</h2><p className="mt-1 text-xs text-[var(--app-muted)]">Live work and immediate operational state</p></div><span className="text-sm text-[var(--app-muted)]">{loading ? '—' : liveJobs.length}</span></div>
            <div className="divide-y divide-[var(--app-line)]">
              {liveJobs.slice(0, 6).map(lead => {
                const quote = quoteFor(lead); const stage = deriveOperatingStage(lead, quote); const execution = latestExecution(lead); const readiness = deriveJobReadiness(lead, quote)
                return <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="grid gap-3 px-1 py-4 transition hover:bg-[#faf8f2] sm:grid-cols-[minmax(0,1fr)_minmax(180px,.7fr)_auto] sm:items-center"><div><div className="font-semibold text-[#071421]">{lead.name}</div><div className="mt-1 text-xs text-[var(--app-muted)]">{routeLabel(lead, quote)} · {lead.branch || 'Branch TBD'}</div></div><div><div className="text-sm text-[#344054]">{execution?.label || (stage === 'dispatched' ? 'Crew confirmed for dispatch' : 'Scheduled today')}</div><div className="mt-1 text-xs text-[var(--app-muted)]">{readiness.label} · {readiness.percent}% prepared</div></div><span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone(stage)}`}>{OPERATING_STAGE_META[stage].label}</span></Link>
              })}
              {!liveJobs.length && <div className="py-8 text-sm text-[var(--app-muted)]">No jobs are currently marked as dispatched or in progress.</div>}
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between border-b border-[var(--app-line)] pb-3"><div><h2 className="text-xl font-semibold text-[#071421]">Today</h2><p className="mt-1 text-xs text-[var(--app-muted)]">Jobs, estimates and callbacks already committed</p></div><span className="text-sm text-[var(--app-muted)]">{todayJobs.length + todayEstimates.length}</span></div>
            <div className="grid gap-px border-x border-b border-[var(--app-line)] bg-[var(--app-line)] md:grid-cols-2">
              <div className="bg-white p-4"><div className="text-xs font-semibold text-[var(--app-muted)]">Moving work · today and tomorrow</div><div className="mt-3 space-y-3">{todayJobs.slice(0, 5).map(lead => <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="flex justify-between gap-3 text-sm"><span className="font-medium text-[#071421]">{lead.name}</span><span className="text-right text-[var(--app-muted)]">{moveDate(lead, quoteFor(lead)) === today ? 'Today' : 'Tomorrow'}</span></Link>)}{!todayJobs.length && <p className="text-sm text-[var(--app-muted)]">No moves scheduled.</p>}</div></div>
              <div className="bg-white p-4"><div className="text-xs font-semibold text-[var(--app-muted)]">Sales commitments</div><div className="mt-3 space-y-3">{todayEstimates.slice(0, 5).map(lead => <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="flex justify-between gap-3 text-sm"><span className="font-medium text-[#071421]">{lead.name}</span><span className="text-right text-[var(--app-muted)]">{lead.estimateDate === today ? 'Estimate' : 'Callback'}</span></Link>)}{!todayEstimates.length && <p className="text-sm text-[var(--app-muted)]">No estimates or callbacks due.</p>}</div></div>
            </div>
          </section>
        </div>

        <aside>
          <div className="flex items-baseline justify-between border-b border-[var(--app-line)] pb-3"><div><h2 className="text-xl font-semibold text-[#071421]">Attention needed</h2><p className="mt-1 text-xs text-[var(--app-muted)]">Exceptions only; normal work stays quiet</p></div><span className={`text-sm font-semibold ${exceptions.some(item => item.severity === 'urgent') ? 'text-rose-700' : 'text-[var(--app-muted)]'}`}>{exceptions.length}</span></div>
          <div className="divide-y divide-[var(--app-line)]">
            {exceptions.slice(0, 10).map(item => <Link key={item.id} href={item.href} className="block py-4"><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[#071421]">{item.title}</div><div className="mt-1 text-xs font-medium text-[var(--app-muted)]">{item.customer} · {item.environment}</div></div><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.severity === 'urgent' ? 'bg-rose-600' : 'bg-amber-500'}`} /></div><p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">{item.detail}</p><div className="mt-2 text-xs font-semibold text-[#8a6800]">{item.action}</div></Link>)}
            {!exceptions.length && <div className="py-8 text-sm text-[var(--app-muted)]">No operational exceptions are visible in the current records.</div>}
          </div>
        </aside>
      </div>

      <section>
        <div className="mb-3"><h2 className="text-xl font-semibold text-[#071421]">Operating spine</h2><p className="mt-1 text-xs text-[var(--app-muted)]">Where active work currently sits from capture to execution</p></div>
        <div className="grid gap-px overflow-hidden border border-[var(--app-line)] bg-[var(--app-line)] sm:grid-cols-3 lg:grid-cols-9">{stageCounts.map(item => <Link key={item.stage} href={item.stage === 'booked' || item.stage === 'confirmed' || item.stage === 'prepared' || item.stage === 'dispatched' || item.stage === 'in_progress' ? '/sales/operations' : '/sales/pipeline'} className="bg-white p-3 transition hover:bg-[#faf8f2]"><div className="text-2xl font-semibold tabular-nums text-[#071421]">{item.count}</div><div className="mt-1 text-[11px] text-[var(--app-muted)]">{OPERATING_STAGE_META[item.stage].label}</div></Link>)}</div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-xl font-semibold text-[#071421]">Business health</h2><p className="mt-1 text-xs text-[var(--app-muted)]">Compact operational truth, not vanity volume</p></div>
        <div className="grid gap-px border border-[var(--app-line)] bg-[var(--app-line)] sm:grid-cols-2 lg:grid-cols-5">{[
          ['Booked revenue', formatMoney(bookedRevenue)], ['Completed revenue', formatMoney(completedRevenue)], ['Booking conversion', `${conversion}%`], ['Next 7 days', `${nextSevenJobs.length} jobs`], ['Capacity risk', `${atRiskNextSeven} not fully ready`],
        ].map(([label, value]) => <div key={label} className="bg-white p-4"><div className="text-xs text-[var(--app-muted)]">{label}</div><div className="mt-2 text-xl font-semibold tabular-nums text-[#071421]">{loading ? '—' : value}</div></div>)}</div>
      </section>
    </section>
  )
}
