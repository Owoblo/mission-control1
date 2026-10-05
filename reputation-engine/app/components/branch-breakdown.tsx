'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CRMLead, CRMQuote } from '@/lib/types'
import { formatMoney, isClosedLeadStage } from '@/lib/sales'

type CallCounts = { total: number; inbound: number; outbound: number; answered: number; missed: number; failed: number }
type Breakdown = {
  updatedAt: string
  calls: { today: CallCounts; last30Days: CallCounts; recent: { id: string; at: string; name: string; href: string; direction: string; outcome: string; duration: number }[] }
  partnerships: { total: number; active: number; followUpDue: number; stages: Record<string, number> }
  tasks: { open: number; overdue: number; urgent: number; next: { id: string; title: string; due_at?: string }[] }
}

export function BranchBreakdown({ branch, leads, quotes, loading, onRefresh }: { branch: string; leads: CRMLead[]; quotes: CRMQuote[]; loading: boolean; onRefresh: () => Promise<void> }) {
  const [data, setData] = useState<Breakdown | null>(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let disposed = false
    let pending = false
    const controller = new AbortController()
    async function refresh() {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/sales/branch-breakdown', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Breakdown unavailable')
        const result = await response.json() as Breakdown
        if (!disposed) { setData(result); setError('') }
      } catch {
        if (!disposed) setError('Refresh failed. Any figures shown are from the last successful update.')
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => { disposed = true; controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [branch, refreshKey])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const active = leads.filter(lead => !isClosedLeadStage(lead.stage))
  const stages = leads.reduce<Record<string, number>>((counts, lead) => ({ ...counts, [lead.stage]: (counts[lead.stage] || 0) + 1 }), {})
  const booked = leads.filter(lead => ['booked', 'completed', 'customer_success'].includes(lead.stage))
  const bookedIds = new Set(booked.map(lead => lead.id))
  const bookedValue = quotes.filter(quote => bookedIds.has(quote.leadId || '')).reduce((sum, quote) => sum + Number(quote.total || 0), 0)
  const followUps = active.filter(lead => lead.followUpDate && lead.followUpDate <= today)
  const label = branch.charAt(0).toUpperCase() + branch.slice(1)
  const metric = (name: string, value: number | string | undefined, href: string) => <Link href={href} className="block border border-[var(--app-line)] p-4 hover:bg-[#faf8f2]"><div className="text-xs text-[var(--app-muted)]">{name}</div><div className="mt-2 text-2xl font-semibold">{value ?? '—'}</div></Link>
  return <section className="space-y-5 border-b border-[var(--app-line)] pb-8" aria-label={`${label} breakdown`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-semibold">{label} · daily breakdown</h1><p className="mt-2 text-sm text-[var(--app-muted)]">Your branch’s calls, sales, partnerships and work due. Refreshes every minute while this page is visible.</p><p className="mt-1 text-xs text-[var(--app-muted)]">{data ? `Calls, partnerships and tasks updated ${new Date(data.updatedAt).toLocaleString('en-CA', { timeZone: 'America/Toronto' })} · Toronto time` : 'Loading branch activity…'}</p></div><button className="crm-button" onClick={() => { setRefreshKey(key => key + 1); void onRefresh() }}>Refresh breakdown</button></div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metric('Active customer leads', loading ? undefined : active.length, '/sales/pipeline')}
      {metric('Quotes · current records', loading ? undefined : quotes.length, '/sales/quotes')}
      {metric('Booked / completed jobs', loading ? undefined : booked.length, '/sales/operations')}
      {metric('Booked / completed quote value', loading ? undefined : formatMoney(bookedValue), '/sales/quotes')}
      {metric('Customer follow-ups due', loading ? undefined : followUps.length, '/sales/follow-up')}
      {metric('Partnership contacts', data?.partnerships.total, '/marketing/partners')}
      {metric('Active partnerships', data?.partnerships.active, '/marketing/partners')}
      {metric('Partner follow-ups due', data?.partnerships.followUpDue, '/marketing/queue')}
      {metric('Open tasks', data?.tasks.open, '/sales/tasks')}
      {metric('Overdue tasks', data?.tasks.overdue, '/sales/tasks')}
      {metric('High priority / urgent tasks', data?.tasks.urgent, '/sales/tasks')}
      {metric('Missed calls today', data?.calls.today.missed, '/sales/inbox')}
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div><h2 className="mb-3 text-lg font-semibold">Calls</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Period', 'Total', 'In', 'Out', 'Answered', 'Missed', 'Failed'].map(title => <th className="p-2 font-medium" key={title}>{title}</th>)}</tr></thead><tbody>{(['today', 'last30Days'] as const).map(period => <tr key={period} className="border-t border-[var(--app-line)]"><td className="p-2">{period === 'today' ? 'Today' : 'Last 30 days'}</td>{(['total', 'inbound', 'outbound', 'answered', 'missed', 'failed'] as const).map(key => <td className="p-2" key={key}>{data?.calls[period][key] ?? '—'}</td>)}</tr>)}</tbody></table></div><p className="mt-2 text-xs text-[var(--app-muted)]">Recorded call outcomes on this branch’s lines or linked customer records.</p></div>
      <div><h2 className="mb-3 text-lg font-semibold">Pipeline breakdown</h2><div className="flex flex-wrap gap-2">{Object.entries(stages).map(([stage, count]) => <Link href="/sales/pipeline" key={stage} className="rounded border border-[var(--app-line)] px-3 py-2 text-sm">{stage.replaceAll('_', ' ')}: {count}</Link>)}{!loading && !leads.length && <p className="text-sm">No customer leads recorded.</p>}</div><h3 className="mb-2 mt-4 font-semibold">Partnership stages</h3><div className="flex flex-wrap gap-2">{Object.entries(data?.partnerships.stages || {}).map(([stage, count]) => <Link href="/marketing/partners" key={stage} className="rounded border border-[var(--app-line)] px-3 py-2 text-sm">{stage.replaceAll('_', ' ')}: {count}</Link>)}</div></div>
      <div><h2 className="mb-2 text-lg font-semibold">Recent calls · last 30 days</h2>{data?.calls.recent.map(call => <Link key={call.id} href={call.href} className="block border-b border-[var(--app-line)] py-3 text-sm"><div className="font-medium">{call.name} · {call.outcome}</div><div className="mt-1 text-[var(--app-muted)]">{new Date(call.at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })} · {call.direction} · {call.duration}s</div></Link>)}{data && !data.calls.recent.length && <p className="text-sm text-[var(--app-muted)]">No recorded call outcomes in this period.</p>}</div>
      <div><h2 className="mb-2 text-lg font-semibold">Next tasks</h2>{data?.tasks.next.map(task => <Link href="/sales/tasks" key={task.id} className="block border-b border-[var(--app-line)] py-3 text-sm"><div className="font-medium">{task.title}</div><div className="mt-1 text-[var(--app-muted)]">{task.due_at ? new Date(task.due_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : 'No due date'}</div></Link>)}{data && !data.tasks.next.length && <p className="text-sm text-[var(--app-muted)]">No open branch tasks.</p>}</div>
    </div>
  </section>
}
