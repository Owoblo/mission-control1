'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { dateStamp, formatDate, formatMoney, isClosedLeadStage } from '@/lib/sales'
import { fetchDashboardDrilldown, fetchSalesOverview, sendSalesMessage, updateSalesLead } from '@/lib/sales-api'
import { compareLeadsByGuidance, formatRelativeTime, getLeadGuidance } from '@/lib/lead-guidance'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type { CRMLead, CRMQuote, FollowUpLog, SalesDashboardSummary } from '@/lib/types'
import type { DashboardDrilldownMetric, DashboardDrilldownResponse } from '@/lib/sales-api'

type TelephonyMetrics = {
  totalCallsToday: number
  missedCallsToday: number
  failedCallsToday: number
  mediaConnectionFailuresToday: number
  avgAnswerTimeSeconds: number | null
  browserCallsToday: number
  mobileCallsToday: number
  callsWithNoAudioToday: number
  abandonedBeforeAnswerToday: number
}

type TelephonyHealth = {
  metrics?: TelephonyMetrics | null
  browserPresence?: { active: boolean; sessionCount: number } | null
}

type LiveFeedEvent = {
  text: string
  date: string
  tone: 'accepted' | 'viewed' | 'new' | 'neutral'
}

function buildLiveFeedEvents(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]): LiveFeedEvent[] {
  const events: LiveFeedEvent[] = []
  ;(lead.callLogs || []).forEach(item => {
    const label = item.isVoicemail ? 'Voicemail dropped' : item.aiSummary?.summary || item.notes || 'Call logged'
    events.push({ text: label, date: item.date, tone: 'neutral' })
  })
  // Include follow-up logs (SMS, email, notes) for this lead
  ;(followUps || []).filter(f => f.leadId === lead.id && f.type !== 'note').forEach(f => {
    const prefix = f.type === 'sms' ? 'SMS sent' : f.type === 'email' ? 'Email sent' : f.type
    const preview = f.notes ? ` — "${f.notes.slice(0, 60)}${f.notes.length > 60 ? '…' : ''}"` : ''
    events.push({ text: `${prefix}${preview}`, date: f.date || f.createdAt, tone: 'neutral' })
  })
  if (quote?.status === 'declined') events.push({ text: `${quote.number} declined.`, date: quote.respondedAt || quote.createdAt, tone: 'neutral' })
  if (quote?.acceptedAt) events.push({ text: `${quote.number} accepted.`, date: quote.acceptedAt, tone: 'accepted' })
  if (quote?.viewedAt) events.push({ text: `${quote.number} viewed.`, date: quote.viewedAt, tone: 'viewed' })
  if (quote?.sentAt) events.push({ text: `${quote.number} sent.`, date: quote.sentAt, tone: 'neutral' })
  if (events.length === 0) {
    events.push({ text: 'Lead created.', date: lead.createdAt, tone: lead.stage === 'new' ? 'new' : 'neutral' })
  }
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return events
}

function latestTimelineText(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]) {
  return buildLiveFeedEvents(lead, quote, followUps)[0]?.text || 'Lead created.'
}

function latestActivityDate(lead: CRMLead, quote?: CRMQuote, followUps?: FollowUpLog[]) {
  return buildLiveFeedEvents(lead, quote, followUps)[0]?.date || lead.createdAt
}

function ageLabel(ms: number) {
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function leadOwnedByUser(lead: CRMLead, user?: { userId?: string | null; name?: string | null } | null) {
  if (!user) return false
  const ownerUserId = lead.assignedRepUserId?.trim()
  const ownerName = lead.assignedRepName?.trim() || lead.assignedRep?.trim()
  return (!!ownerUserId && ownerUserId === user.userId) || (!!ownerName && ownerName === user.name)
}

function readLocalStorageFlag(key: string) {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLocalStorageFlag(key: string, value: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage?.setItem(key, value ? '1' : '0')
  } catch {}
}

export default function SalesDashboardPage() {
  const router = useRouter()
  const currentUser = useCurrentUser()
  const [leads, setLeads] = useState<CRMLead[]>([])
  const [quotes, setQuotes] = useState<CRMQuote[]>([])
  const [followUps, setFollowUps] = useState<FollowUpLog[]>([])
  const [summary, setSummary] = useState<SalesDashboardSummary | null>(null)
  const [telephonyHealth, setTelephonyHealth] = useState<TelephonyHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [drilldown, setDrilldown] = useState<DashboardDrilldownResponse | null>(null)
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  // Keep the server and first browser render identical. Persisted display
  // preferences are applied after hydration to avoid a markup mismatch.
  const [actionsCollapsed, setActionsCollapsed] = useState(false)
  const [workflowHidden, setWorkflowHidden] = useState(false)
  const [statsCollapsed, setStatsCollapsed] = useState(false)
  const [advancedDashboardOpen, setAdvancedDashboardOpen] = useState(false)

  useEffect(() => {
    setActionsCollapsed(readLocalStorageFlag('ss_actions_collapsed'))
    setWorkflowHidden(readLocalStorageFlag('ss_workflow_hidden'))
    setStatsCollapsed(readLocalStorageFlag('ss_stats_collapsed'))
    setAdvancedDashboardOpen(readLocalStorageFlag('ss_sales_dashboard_advanced_open'))
  }, [])

  function toggleActions() {
    setActionsCollapsed(v => {
      const next = !v
      writeLocalStorageFlag('ss_actions_collapsed', next)
      return next
    })
  }
  function toggleStats() {
    setStatsCollapsed(v => {
      const next = !v
      writeLocalStorageFlag('ss_stats_collapsed', next)
      return next
    })
  }
  function toggleAdvancedDashboard() {
    setAdvancedDashboardOpen(v => {
      const next = !v
      writeLocalStorageFlag('ss_sales_dashboard_advanced_open', next)
      return next
    })
  }

  async function openDrilldown(metric: DashboardDrilldownMetric) {
    try {
      setDrilldownLoading(true)
      setDrilldown({ metric, title: 'Loading…', subtitle: 'Gathering live rows behind this metric.', items: [] })
      const payload = await fetchDashboardDrilldown(metric)
      setDrilldown(payload)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDrilldownLoading(false)
    }
  }

  // Operations leads belong on the operations page, not here
  useEffect(() => {
    if (currentUser?.role === 'operations_lead') {
      router.replace('/sales/operations')
    }
  }, [currentUser?.role, router])

  async function refresh() {
    try {
      setLoading(true)
      const [data, telephonyResponse] = await Promise.all([
        fetchSalesOverview(),
        fetch('/api/sales/telephony-health', { cache: 'no-store', credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      setLeads(data.leads)
      setQuotes(data.quotes)
      setFollowUps(data.followUps)
      setSummary(data.summary)
      setTelephonyHealth(telephonyResponse)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Silent background refresh every 60s
    const interval = setInterval(() => {
      if (document.hidden) return
      Promise.all([
        fetchSalesOverview(),
        fetch('/api/sales/telephony-health', { cache: 'no-store', credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ])
        .then(([data, telephonyResponse]) => {
          setLeads(data.leads)
          setQuotes(data.quotes)
          setFollowUps(data.followUps)
          setSummary(data.summary)
          setTelephonyHealth(telephonyResponse)
        })
        .catch(() => {/* silently ignore — stale data is fine */})
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  async function dismissTask(lead: CRMLead) {
    setDismissed(prev => new Set(Array.from(prev).concat(lead.id)))
    try {
      await updateSalesLead(lead.id, { followUpDate: undefined })
    } catch {
      setDismissed(prev => { const next = new Set(prev); next.delete(lead.id); return next })
    }
  }

  const quoteMap = useMemo(() => new Map(quotes.map(item => [item.id, item])), [quotes])
  const followUpsByLead = useMemo(() => {
    const map = new Map<string, FollowUpLog[]>()
    for (const item of followUps) {
      if (!item.leadId) continue
      const existing = map.get(item.leadId) || []
      existing.push(item)
      map.set(item.leadId, existing)
    }
    return map
  }, [followUps])
  const today = dateStamp()
  const dashboardMode = currentUser?.role === 'sales_rep' ? 'rep' : currentUser?.role === 'manager' ? 'manager' : 'admin'
  const quotesSentToday = useMemo(
    () => quotes.filter(item => item.sentAt && item.sentAt.slice(0, 10) === today).length,
    [quotes, today]
  )
  const scopedLeads = useMemo(() => {
    if (dashboardMode !== 'rep') return leads
    return leads.filter(lead => leadOwnedByUser(lead, currentUser) || !lead.assignedRepUserId)
  }, [currentUser, dashboardMode, leads])
  const scopedActiveLeads = useMemo(
    () => scopedLeads.filter(lead => !isClosedLeadStage(lead.stage)),
    [scopedLeads]
  )
  const guidedLeads = useMemo(() => {
    return scopedLeads
      .filter(lead => !isClosedLeadStage(lead.stage))
      .map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) || null : null
        const leadFollowUps = followUpsByLead.get(lead.id) || []
        return {
          lead,
          quote,
          guidance: getLeadGuidance(lead, quote, leadFollowUps),
        }
      })
      .sort((left, right) => compareLeadsByGuidance(
        { lead: left.lead, quote: left.quote, followUps: followUpsByLead.get(left.lead.id) || [] },
        { lead: right.lead, quote: right.quote, followUps: followUpsByLead.get(right.lead.id) || [] },
      ))
  }, [followUpsByLead, quoteMap, scopedLeads])
  const followUpFocus = useMemo(() => {
    return guidedLeads
      .filter(item => !dismissed.has(item.lead.id) && item.lead.followUpDate && item.lead.followUpDate <= today)
      .slice(0, 5)
  }, [dismissed, guidedLeads, today])

  const expiringQuotes = useMemo(() => {
    return quotes
      .filter(q => (q.status === 'sent' || q.status === 'viewed') && daysUntilExpiry(q) !== null && (daysUntilExpiry(q) as number) <= 7)
      .sort((a, b) => (daysUntilExpiry(a) ?? 99) - (daysUntilExpiry(b) ?? 99))
      .slice(0, 5)
  }, [quotes])

  const requiredActions = useMemo(() => {
    return guidedLeads
      .filter(item => !dismissed.has(item.lead.id))
      .slice(0, 12)
  }, [dismissed, guidedLeads])
  const hotCloseOpportunities = useMemo(() => {
    return guidedLeads
      .filter(item => item.quote && ['quoted', 'pricing', 'tentative', 'contacted', 'new'].includes(item.lead.stage))
      .filter(item => item.guidance.heat.label === 'Hot' || item.guidance.heat.label === 'At Risk' || item.guidance.action.category === 'quote_viewed' || item.guidance.action.category === 'quote_viewed_multi' || item.guidance.action.category === 'deposit_unpaid')
      .slice(0, 5)
  }, [guidedLeads])
  const newInboundLeads = useMemo(() => {
    return guidedLeads
      .filter(item => item.guidance.action.category === 'new_lead')
      .slice(0, 5)
  }, [guidedLeads])
  const quoteViewFollowUps = useMemo(() => {
    return guidedLeads
      .filter(item => item.guidance.action.category === 'quote_viewed' || item.guidance.action.category === 'quote_viewed_multi')
      .slice(0, 5)
  }, [guidedLeads])
  const pendingDeposits = useMemo(() => {
    return guidedLeads
      .filter(item => item.quote && (item.guidance.action.category === 'deposit_unpaid' || item.guidance.action.category === 'move_date_soon'))
      .slice(0, 5)
  }, [guidedLeads])
  const unassignedLeads = useMemo(() => {
    return guidedLeads
      .filter(item => item.guidance.action.category === 'unassigned_lead')
      .slice(0, 5)
  }, [guidedLeads])
  const myBookedJobs = useMemo(() => {
    return leads
      .filter(lead => leadOwnedByUser(lead, currentUser))
      .filter(lead => lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success')
      .slice(0, 5)
  }, [currentUser, leads])
  const workingQueue = useMemo(() => {
    return guidedLeads
      .filter(item => ['no_quote_sent', 'follow_up_overdue', 'missing_required_info', 'unassigned_lead', 'realtor_opportunity'].includes(item.guidance.action.category))
      .slice(0, 6)
  }, [guidedLeads])
  const waitingQueue = useMemo(() => {
    return guidedLeads
      .filter(item => ['quote_viewed', 'quote_viewed_multi', 'quote_expiring', 'deposit_unpaid', 'move_date_soon', 'dormant'].includes(item.guidance.action.category))
      .slice(0, 6)
  }, [guidedLeads])
  const bookedQueue = useMemo(() => {
    return leads
      .filter(lead => {
        if (dashboardMode === 'rep' && !leadOwnedByUser(lead, currentUser)) return false
        return lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success'
      })
      .sort((left, right) => {
        const leftDate = new Date(left.moveDate || left.createdAt).getTime()
        const rightDate = new Date(right.moveDate || right.createdAt).getTime()
        return leftDate - rightDate
      })
      .slice(0, 6)
      .map(lead => ({
        lead,
        quote: lead.quoteId ? quoteMap.get(lead.quoteId) || null : null,
      }))
  }, [currentUser, dashboardMode, leads, quoteMap])

  const liveFeed = useMemo(() => {
    return leads
      .slice()
      .sort((a, b) => {
        const quoteA = a.quoteId ? quoteMap.get(a.quoteId) : undefined
        const quoteB = b.quoteId ? quoteMap.get(b.quoteId) : undefined
        const aDate = buildLiveFeedEvents(a, quoteA, followUps)[0]?.date || a.createdAt
        const bDate = buildLiveFeedEvents(b, quoteB, followUps)[0]?.date || b.createdAt
        return new Date(bDate).getTime() - new Date(aDate).getTime()
      })
      .slice(0, 8)
      .map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) : undefined
        const latestEvent = buildLiveFeedEvents(lead, quote, followUps)[0]
        return {
          id: lead.id,
          href: `/sales/leads/${lead.id}`,
          title: latestEvent?.text || 'Lead created.',
          subtitle: `${lead.name} · ${lead.originAddress || lead.originCity || 'Origin TBD'} to ${lead.destAddress || lead.destCity || 'Destination TBD'}`,
          date: latestEvent?.date || lead.createdAt,
          tone: latestEvent?.tone || 'neutral',
        }
      })
  }, [leads, quoteMap, followUps])

  async function handleActionCta(lead: CRMLead, quote: CRMQuote | null, ctaKey: string) {
    if (ctaKey === 'call_now' || ctaKey === 'call_back') {
      if (lead.phone) {
        window.dispatchEvent(new CustomEvent('crm:open-dialer', { detail: { phone: lead.phone, leadId: lead.id, name: lead.name } }))
        return
      }
      router.push(`/sales/leads/${lead.id}`)
      return
    }

    if (ctaKey === 'open_quote' && quote) {
      router.push(`/sales/quotes/${quote.id}`)
      return
    }

    if (ctaKey === 'assign_to_me' && currentUser?.userId) {
      const updated = await updateSalesLead(lead.id, {
        assignedRep: currentUser.name || undefined,
        assignedRepName: currentUser.name || undefined,
        assignedRepUserId: currentUser.userId,
      })
      setLeads(current => current.map(item => item.id === updated.id ? updated : item))
      return
    }

    if (ctaKey === 'snooze') {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      const updated = await updateSalesLead(lead.id, {
        followUpDate: tomorrow,
        followUpNote: `Snoozed from dashboard on ${new Date().toLocaleDateString('en-CA')}`,
      })
      setLeads(current => current.map(item => item.id === updated.id ? updated : item))
      return
    }

    router.push(`/sales/leads/${lead.id}`)
  }

  return (
    <div className="crm-shell">
      <div className="space-y-10">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-[2rem] font-semibold tracking-tight text-[var(--app-ink)] md:text-[28px]">
              {dashboardMode === 'rep' ? 'Sales Rep Dashboard' : dashboardMode === 'manager' ? 'Manager Dashboard' : 'Sales Command'}
            </h1>
            <div className="mt-2 text-sm text-[var(--app-muted)]">
              {dashboardMode === 'rep'
                ? 'Start with the required actions queue. Everything else should help you close or unblock leads faster.'
                : dashboardMode === 'manager'
                  ? 'Watch team response speed, urgent actions, and close risk before looking at passive metrics.'
                  : 'Use the queue first, then scan revenue, team urgency, and live customer movement.'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--app-accent)]" />
              Auto-refreshes every 60s
            </div>
            <button onClick={() => void refresh()} className="crm-button">Refresh now</button>
          </div>
        </section>

        {error ? <div className="rounded-[4px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-0 border border-[var(--app-line)] bg-[var(--app-panel)] md:grid-cols-4">
          <button
            type="button"
            onClick={() => void openDrilldown('active_leads')}
            className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
          >
            <div className="crm-label">{dashboardMode === 'rep' ? 'My Active Leads' : 'Total Active Leads'}</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{dashboardMode === 'rep' ? scopedActiveLeads.length : (summary?.activeLeads ?? 0)}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{requiredActions.length} required today · click to inspect</div>
          </button>
          <button
            type="button"
            onClick={() => void openDrilldown(dashboardMode === 'rep' ? 'hot_close_opportunities' : 'quotes_sent_today')}
            className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
          >
            <div className="crm-label">{dashboardMode === 'rep' ? 'Hot Close Opportunities' : 'Quotes Sent Today'}</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{dashboardMode === 'rep' ? hotCloseOpportunities.length : quotesSentToday}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{dashboardMode === 'rep' ? `${quoteViewFollowUps.length} quote views need follow-up` : `${quotes.filter(item => item.sentAt).length} total sent`} · click to inspect</div>
          </button>
          <button
            type="button"
            onClick={() => void openDrilldown(dashboardMode === 'rep' ? 'pending_deposits' : 'booked_jobs')}
            className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
          >
            <div className="crm-label">{dashboardMode === 'rep' ? 'Pending Deposits' : 'Booked Jobs'}</div>
            <div className="mt-2 text-5xl font-semibold leading-none text-[var(--app-ink)]">{dashboardMode === 'rep' ? pendingDeposits.length : (summary?.bookedLeads ?? 0)}</div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{dashboardMode === 'rep' ? `${myBookedJobs.length} booked / completed` : `${summary?.quotedLeads ?? 0} tentative / quoted`} · click to inspect</div>
          </button>
          <button
            type="button"
            onClick={() => void openDrilldown(dashboardMode === 'rep' ? 'follow_ups_due' : 'booked_revenue')}
            className="p-5 text-left transition hover:bg-[var(--app-bg)]"
          >
            <div className="crm-label">{dashboardMode === 'rep' ? 'My Follow-ups Due' : 'Confirmed Revenue'}</div>
            <div className={`mt-2 text-5xl font-semibold leading-none ${dashboardMode !== 'rep' && (summary?.bookedRevenue ?? 0) > 0 ? 'text-emerald-600' : 'text-[var(--app-ink)]'}`}>
              {dashboardMode === 'rep' ? followUpFocus.length : formatMoney(summary?.bookedRevenue ?? 0)}
            </div>
            <div className="mt-2 text-sm text-[var(--app-muted)]">{dashboardMode === 'rep' ? `${newInboundLeads.length} new inbound leads` : `${formatMoney(summary?.quotedPipelineValue ?? 0)} in open pipeline`} · click to inspect</div>
          </button>
        </div>

        {workflowHidden ? (
        <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold text-[var(--app-ink)]">Simple Workflow hidden</div>
              <div className="mt-1 text-xs text-[var(--app-muted)]">
                New {newInboundLeads.length} · Working {workingQueue.length} · Waiting {waitingQueue.length} · Booked {bookedQueue.length}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setWorkflowHidden(false)
                writeLocalStorageFlag('ss_workflow_hidden', false)
              }}
              className="shrink-0 rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--app-ink)] transition hover:border-[var(--app-ink)]"
            >
              Show simple workflow
            </button>
          </div>
        </section>
        ) : (
        <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
          <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-[1.35rem] font-semibold tracking-tight text-[var(--app-ink)]">Simple Workflow</h2>
              <div className="mt-1 text-sm text-[var(--app-muted)]">
                Same pattern as a lighter quote CRM: start from the queue, keep the lists short, and push everything else behind advanced views.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-[var(--app-muted)]">Open a lead only when it needs action. Everything else can wait.</div>
              <button
                onClick={() => { setWorkflowHidden(true); writeLocalStorageFlag('ss_workflow_hidden', true) }}
                className="shrink-0 rounded-full border border-[var(--app-line)] px-2.5 py-1 text-[10px] font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                title="Hide this section"
              >
                Hide
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4 pt-5 lg:grid-cols-2">
              {['New', 'Working', 'Waiting', 'Booked'].map(label => (
                <div key={label} className="rounded-[10px] border border-dashed border-[var(--app-line)] px-4 py-10 text-center text-sm text-[var(--app-muted)]">
                  Loading {label.toLowerCase()} queue...
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 pt-5 lg:grid-cols-2">
              <div className="rounded-[10px] border border-[var(--app-line)] bg-white">
                <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">New</div>
                    <div className="text-xs text-[var(--app-muted)]">Fresh inbound leads and replies</div>
                  </div>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--app-muted)]">{newInboundLeads.length}</span>
                </div>
                <div className="divide-y divide-[var(--app-line)]">
                  {newInboundLeads.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-[var(--app-muted)]">Nothing new right now.</div>
                  ) : newInboundLeads.map(({ lead, guidance }) => (
                    <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block px-4 py-3 transition hover:bg-[var(--app-bg)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                          <div className="mt-1 truncate text-xs text-[var(--app-muted)]">{guidance.sourceLabel} · {guidance.action.reason}</div>
                        </div>
                        <div className="shrink-0 text-xs text-[var(--app-muted)]">{timeLabel(lead.createdAt)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-[10px] border border-[var(--app-line)] bg-white">
                <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">Working</div>
                    <div className="text-xs text-[var(--app-muted)]">Needs rep action before a quote is out</div>
                  </div>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--app-muted)]">{workingQueue.length}</span>
                </div>
                <div className="divide-y divide-[var(--app-line)]">
                  {workingQueue.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-[var(--app-muted)]">No open prep work right now.</div>
                  ) : workingQueue.map(({ lead, quote, guidance }) => (
                    <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block px-4 py-3 transition hover:bg-[var(--app-bg)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                          <div className="mt-1 truncate text-xs text-[var(--app-muted)]">{guidance.action.nextAction}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-[var(--app-muted)]">
                          <div>{quote?.total ? formatMoney(quote.total) : guidance.stageLabel}</div>
                          <div className="mt-1">{lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-[10px] border border-[var(--app-line)] bg-white">
                <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">Waiting</div>
                    <div className="text-xs text-[var(--app-muted)]">Quote is out or customer owes a response</div>
                  </div>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--app-muted)]">{waitingQueue.length}</span>
                </div>
                <div className="divide-y divide-[var(--app-line)]">
                  {waitingQueue.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-[var(--app-muted)]">No waiting leads right now.</div>
                  ) : waitingQueue.map(({ lead, quote, guidance }) => (
                    <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block px-4 py-3 transition hover:bg-[var(--app-bg)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                          <div className="mt-1 truncate text-xs text-[var(--app-muted)]">{guidance.quoteStatusLine}</div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-[var(--app-muted)]">
                          <div>{quote?.total ? formatMoney(quote.total) : guidance.stageLabel}</div>
                          <div className="mt-1">{guidance.heat.label}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-[10px] border border-[var(--app-line)] bg-white">
                <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--app-ink)]">Booked</div>
                    <div className="text-xs text-[var(--app-muted)]">Confirmed and completed jobs</div>
                  </div>
                  <span className="rounded-full bg-[var(--app-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--app-muted)]">{bookedQueue.length}</span>
                </div>
                <div className="divide-y divide-[var(--app-line)]">
                  {bookedQueue.length === 0 ? (
                    <div className="px-4 py-8 text-sm text-[var(--app-muted)]">No booked jobs in this view yet.</div>
                  ) : bookedQueue.map(({ lead, quote }) => (
                    <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block px-4 py-3 transition hover:bg-[var(--app-bg)]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--app-ink)]">{lead.name}</div>
                          <div className="mt-1 truncate text-xs text-[var(--app-muted)]">{lead.stage.replace(/_/g, ' ')} · {lead.moveDate ? formatDate(lead.moveDate) : 'Date TBD'}</div>
                        </div>
                        <div className="shrink-0 text-xs text-[var(--app-muted)]">{quote?.total ? formatMoney(quote.total) : 'Booked'}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        <button
          type="button"
          onClick={toggleAdvancedDashboard}
          className="flex w-full items-center justify-between rounded-[10px] border border-[var(--app-line)] bg-white px-4 py-3 text-left transition hover:border-[var(--app-ink)]"
        >
          <div>
            <div className="text-sm font-semibold text-[var(--app-ink)]">Advanced queues and call stats</div>
            <div className="mt-1 text-xs text-[var(--app-muted)]">Keep this collapsed unless you need deeper triage.</div>
          </div>
          <span className="text-xs font-semibold text-[var(--app-muted)]">{advancedDashboardOpen ? 'Hide' : 'Show'}</span>
        </button>

        {advancedDashboardOpen ? (
          <>
            {dashboardMode !== 'rep' ? (
              <>
                <button onClick={toggleStats} className="flex items-center gap-2 text-xs font-medium text-[var(--app-muted)] hover:text-[var(--app-ink)] transition-colors mb-1 ml-1">
                  <span>{statsCollapsed ? '▶' : '▼'}</span>
                  <span>{statsCollapsed ? 'Show call stats' : 'Hide call stats'}</span>
                </button>
                {!statsCollapsed && <div className="grid gap-0 border border-[var(--app-line)] bg-[var(--app-panel)] md:grid-cols-5">
                <button
                  className="border-b border-[var(--app-line)] p-5 md:border-b-0 md:border-r text-left w-full hover:bg-[var(--app-bg)] transition"
                  onClick={() => void openDrilldown('calls_today')}
                  title="Click to see today's calls"
                >
                  <div className="crm-label">Calls Today</div>
                  <div className="mt-2 text-4xl font-semibold leading-none text-[var(--app-ink)]">{telephonyHealth?.metrics?.totalCallsToday ?? 0}</div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">{telephonyHealth?.browserPresence?.sessionCount ?? 0} browser sessions · <span className="text-[#1a2744] underline text-xs">view calls →</span></div>
                </button>
                <button
                  type="button"
                  onClick={() => void openDrilldown('missed_calls_today')}
                  className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
                >
                  <div className="crm-label">Missed Calls</div>
                  <div className="mt-2 text-4xl font-semibold leading-none text-[var(--app-ink)]">{telephonyHealth?.metrics?.missedCallsToday ?? 0}</div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">{telephonyHealth?.metrics?.abandonedBeforeAnswerToday ?? 0} abandoned before answer</div>
                </button>
                <button
                  type="button"
                  onClick={() => void openDrilldown('failed_calls_today')}
                  className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
                >
                  <div className="crm-label">Failed Calls</div>
                  <div className="mt-2 text-4xl font-semibold leading-none text-[var(--app-ink)]">{telephonyHealth?.metrics?.failedCallsToday ?? 0}</div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">{telephonyHealth?.metrics?.mediaConnectionFailuresToday ?? 0} media failures (53405)</div>
                </button>
                <button
                  type="button"
                  onClick={() => void openDrilldown('calls_today')}
                  className="border-b border-[var(--app-line)] p-5 text-left transition hover:bg-[var(--app-bg)] md:border-b-0 md:border-r"
                >
                  <div className="crm-label">Browser vs Mobile</div>
                  <div className="mt-2 text-2xl font-semibold leading-none text-[var(--app-ink)]">
                    {telephonyHealth?.metrics?.browserCallsToday ?? 0} / {telephonyHealth?.metrics?.mobileCallsToday ?? 0}
                  </div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">Browser answered / Groundwire-mobile answered</div>
                </button>
                <button
                  type="button"
                  onClick={() => void openDrilldown('calls_today')}
                  className="p-5 text-left transition hover:bg-[var(--app-bg)]"
                >
                  <div className="crm-label">Average Answer Time</div>
                  <div className="mt-2 text-4xl font-semibold leading-none text-[var(--app-ink)]">
                    {telephonyHealth?.metrics?.avgAnswerTimeSeconds ?? '—'}
                  </div>
                  <div className="mt-2 text-sm text-[var(--app-muted)]">Seconds to first answer</div>
                </button>
              </div>}
              </>
            ) : null}

            {loading ? (
              <div className="rounded-[4px] border border-[rgba(228,226,220,1)] bg-white px-4 py-16 text-center text-sm text-[var(--app-muted)]">Loading dashboard...</div>
            ) : (
              <>
            <section>
              <button onClick={toggleActions} className="mb-3 w-full flex items-center justify-between border-b border-[var(--app-line)] pb-2 group">
                <h2 className="font-display text-[1.1rem] font-semibold tracking-tight text-[var(--app-ink)] flex items-center gap-2">
                  <span className="text-[var(--app-muted)] text-sm">{actionsCollapsed ? '▶' : '▼'}</span>
                  Today&apos;s Required Actions
                </h2>
                <span className="rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
                  {requiredActions.length} prioritized
                </span>
              </button>
              {!actionsCollapsed && requiredActions.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-5 py-12 text-center text-sm text-[var(--app-muted)]">
                  No required actions right now.
                </div>
              ) : !actionsCollapsed ? (
                <div className="grid gap-2 xl:grid-cols-2">
                  {requiredActions.map(({ lead, quote, guidance }) => (
                    <div key={lead.id} className={`rounded-[8px] border bg-[var(--app-panel)] px-3 py-2.5 ${guidance.action.goldenMoment ? 'border-orange-300 shadow-[0_4px_12px_rgba(249,115,22,0.08)]' : guidance.heat.tone === 'risk' ? 'border-rose-200' : 'border-[var(--app-line)]'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--app-ink)] truncate">{lead.name}</div>
                          <div className="mt-0.5 text-xs text-[var(--app-muted)] truncate">
                            {guidance.stageLabel} · {guidance.sourceLabel}
                            {quote?.total ? ` · ${formatMoney(quote.total)}` : ''}
                            {lead.moveDate ? ` · Move ${formatDate(lead.moveDate)}` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            guidance.heat.tone === 'risk' ? 'border-rose-200 bg-rose-50 text-rose-700' :
                            guidance.heat.tone === 'hot' ? 'border-orange-200 bg-orange-50 text-orange-700' :
                            guidance.heat.tone === 'warm' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                            'border-slate-200 bg-slate-50 text-slate-600'
                          }`}>
                            {guidance.heat.label} · {guidance.heat.score}
                          </span>
                        </div>
                      </div>

                      {guidance.missingInfo.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {guidance.missingInfo.slice(0, 2).map(item => (
                            <span key={item} className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Missing: {item}</span>
                          ))}
                          {guidance.action.goldenMoment ? <span className="rounded-full border border-orange-200 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">QUOTE VIEWED NOW</span> : null}
                        </div>
                      )}

                      <div className="mt-2 rounded-[6px] bg-[#1a2744]/5 px-2.5 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1a2744]/50">Next Action</div>
                        <div className="mt-0.5 text-xs font-semibold text-[#1a2744]">{guidance.action.nextAction}</div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button onClick={() => void handleActionCta(lead, quote, guidance.action.primaryCta.key)} className="rounded-[6px] bg-[var(--app-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0f1b2d]">
                          {guidance.action.primaryCta.label}
                        </button>
                        {guidance.action.secondaryCtas.slice(0, 2).map(cta => (
                          <button key={cta.key} onClick={() => void handleActionCta(lead, quote, cta.key)} className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                            {cta.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            {dashboardMode === 'rep' ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">Hot Close Opportunities</h2>
                    <span className="text-xs text-[var(--app-muted)]">{hotCloseOpportunities.length}</span>
                  </div>
                  <div className="space-y-3">
                    {hotCloseOpportunities.length === 0 ? <div className="text-sm text-[var(--app-muted)]">No hot close opportunities right now.</div> : hotCloseOpportunities.map(({ lead, quote, guidance }) => (
                      <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block rounded-[8px] border border-[var(--app-line)] px-4 py-3 hover:border-orange-300 hover:bg-orange-50/30">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                          <span className="text-xs font-semibold text-orange-700">{guidance.heat.label} {guidance.heat.score}</span>
                        </div>
                        <div className="mt-1 text-sm text-[var(--app-muted)]">{guidance.action.nextAction}</div>
                        <div className="mt-1 text-xs text-[var(--app-muted)]">{quote ? formatMoney(quote.total) : 'No quote'} · {guidance.quoteStatusLine}</div>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">New Inbound Leads</h2>
                    <span className="text-xs text-[var(--app-muted)]">{newInboundLeads.length}</span>
                  </div>
                  <div className="space-y-3">
                    {newInboundLeads.length === 0 ? <div className="text-sm text-[var(--app-muted)]">No fresh inbound leads waiting right now.</div> : newInboundLeads.map(({ lead, guidance }) => (
                      <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block rounded-[8px] border border-[var(--app-line)] px-4 py-3 hover:border-[var(--app-ink)]">
                        <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                        <div className="mt-1 text-sm text-[var(--app-muted)]">{guidance.sourceLabel} · {guidance.action.reason}</div>
                        <div className="mt-1 text-xs text-[var(--app-muted)]">{formatRelativeTime(lead.createdAt)}</div>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">Quote Views Needing Follow-up</h2>
                    <span className="text-xs text-[var(--app-muted)]">{quoteViewFollowUps.length}</span>
                  </div>
                  <div className="space-y-3">
                    {quoteViewFollowUps.length === 0 ? <div className="text-sm text-[var(--app-muted)]">No active quote-view triggers right now.</div> : quoteViewFollowUps.map(({ lead, quote, guidance }) => (
                      <div key={lead.id} className="rounded-[8px] border border-orange-200 bg-orange-50/40 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/sales/leads/${lead.id}`} className="font-medium text-[var(--app-ink)] hover:underline">{lead.name}</Link>
                          <span className="text-xs font-semibold text-orange-700">{quote?.viewedAt ? formatRelativeTime(quote.viewedAt) : 'Just viewed'}</span>
                        </div>
                        <div className="mt-1 text-sm text-[var(--app-muted)]">{guidance.action.nextAction}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                  <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">My Follow-ups Due</h2>
                    <span className="text-xs text-[var(--app-muted)]">{followUpFocus.length}</span>
                  </div>
                  <div className="space-y-3">
                    {followUpFocus.length === 0 ? <div className="text-sm text-[var(--app-muted)]">All caught up.</div> : followUpFocus.map(({ lead, guidance }) => (
                      <div key={lead.id} className="rounded-[8px] border border-[var(--app-line)] px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/sales/leads/${lead.id}`} className="font-medium text-[var(--app-ink)] hover:underline">{lead.name}</Link>
                          <button onClick={() => void dismissTask(lead)} className="text-xs text-[var(--app-muted)] hover:text-[var(--app-ink)]">Done</button>
                        </div>
                        <div className="mt-1 text-sm text-[var(--app-muted)]">{lead.followUpNote || guidance.action.nextAction}</div>
                        <div className="mt-1 text-xs text-[var(--app-muted)]">{lead.followUpDate ? formatDate(lead.followUpDate) : 'Due now'}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-8">
                <section className="col-span-12 lg:col-span-8">
                  <div className="mb-4 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                    <h2 className="font-display text-[1.4rem] font-semibold tracking-tight text-[var(--app-ink)]">Live Feed</h2>
                    <div className="flex items-center gap-2 text-sm text-[var(--app-muted)]">
                      <span className="inline-block h-2 w-2 rounded-full bg-[var(--app-accent)]" />
                      Real-time sync
                    </div>
                  </div>
                  <div className="relative ml-2 before:absolute before:bottom-0 before:left-[15px] before:top-0 before:w-px before:bg-[var(--app-line)]">
                    {liveFeed.map(item => (
                      <Link key={item.id} href={item.href} className="relative -ml-2 block rounded-[4px] py-3 pl-10 transition hover:bg-[#f5f5f5]">
                        <div className="absolute left-[7px] top-4 flex h-[17px] w-[17px] items-center justify-center rounded-full border border-[var(--app-line)] bg-white">
                          <span className={`h-1.5 w-1.5 rounded-full ${item.tone === 'accepted' ? 'bg-[var(--app-accent)]' : item.tone === 'viewed' ? 'bg-[var(--app-warm)]' : item.tone === 'new' ? 'bg-[var(--app-warm)]' : 'bg-stone-300'}`} />
                        </div>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-medium text-[var(--app-ink)]">{item.title}</div>
                            <div className="mt-1 text-sm text-[var(--app-muted)]">{item.subtitle}</div>
                          </div>
                          <div className="text-xs text-[var(--app-muted)]">{timeLabel(item.date)}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>

                <section className="col-span-12 space-y-6 lg:col-span-4">
                  <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                    <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                      <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">{dashboardMode === 'manager' ? 'Unassigned Leads' : 'Pending Deposits'}</h2>
                      <span className="text-xs text-[var(--app-muted)]">{dashboardMode === 'manager' ? unassignedLeads.length : pendingDeposits.length}</span>
                    </div>
                    <div className="space-y-3">
                      {(dashboardMode === 'manager' ? unassignedLeads : pendingDeposits).length === 0 ? (
                        <div className="text-sm text-[var(--app-muted)]">No items right now.</div>
                      ) : (dashboardMode === 'manager' ? unassignedLeads : pendingDeposits).map(({ lead, quote, guidance }) => (
                        <Link key={lead.id} href={`/sales/leads/${lead.id}`} className="block rounded-[8px] border border-[var(--app-line)] px-4 py-3 hover:border-[var(--app-ink)]">
                          <div className="font-medium text-[var(--app-ink)]">{lead.name}</div>
                          <div className="mt-1 text-sm text-[var(--app-muted)]">{guidance.action.nextAction}</div>
                          <div className="mt-1 text-xs text-[var(--app-muted)]">{quote?.total ? formatMoney(quote.total) : guidance.stageLabel}</div>
                        </Link>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-panel)] p-5">
                    <div className="mb-3 flex items-center justify-between border-b border-[var(--app-line)] pb-2">
                      <h2 className="font-display text-xl font-semibold text-[var(--app-ink)]">Expiring Quotes</h2>
                      <span className="text-xs text-[var(--app-muted)]">{expiringQuotes.length}</span>
                    </div>
                    <div className="space-y-3">
                      {expiringQuotes.length === 0 ? <div className="text-sm text-[var(--app-muted)]">No expiring quotes this week.</div> : expiringQuotes.map(quote => {
                        const days = daysUntilExpiry(quote)
                        const lead = quote.leadId ? leads.find(item => item.id === quote.leadId) : undefined
                        return (
                          <Link key={quote.id} href={`/sales/quotes/${quote.id}`} className="block rounded-[8px] border border-amber-100 bg-amber-50/50 px-4 py-3 hover:border-amber-200">
                            <div className="font-medium text-[var(--app-ink)]">{quote.number}</div>
                            <div className="mt-1 text-sm text-[var(--app-muted)]">{lead?.name || 'Unknown'}</div>
                            <div className="mt-1 text-xs text-amber-700">{days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `${days}d left`}</div>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
            )}
          </>
        ) : null}
      </div>

      {drilldown && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrilldown(null)} />
          <div className="relative flex w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--app-ink)]">{drilldown.title}</h2>
                <p className="text-xs text-[var(--app-muted)]">{drilldown.subtitle}</p>
              </div>
              <button onClick={() => setDrilldown(null)} className="rounded-full p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-bg)]">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--app-line)]">
              {drilldownLoading ? (
                <div className="p-8 text-center text-sm text-[var(--app-muted)]">Loading…</div>
              ) : null}
              {!drilldownLoading && drilldown.items.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--app-muted)]">Nothing matched this view.</div>
              ) : null}
              {drilldown.items.map(item => {
                return (
                  <Link key={item.id} href={item.href} onClick={() => setDrilldown(null)} className="block px-5 py-3 transition hover:bg-[var(--app-bg)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--app-ink)]">{item.title}</div>
                        {item.subtitle ? (
                          <div className="mt-0.5 text-xs text-[var(--app-muted)]">{item.subtitle}</div>
                        ) : null}
                        {item.meta ? (
                          <div className="mt-1 text-[11px] text-[var(--app-muted)]">{item.meta}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        {item.badge ? (
                          <div className="rounded-full border border-[var(--app-line)] bg-white px-2 py-0.5 text-[10px] font-semibold capitalize text-[var(--app-muted)]">
                            {item.badge}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function daysUntilExpiry(quote: CRMQuote): number | null {
  if (!quote.createdAt) return null
  const base = new Date(`${quote.createdAt}T12:00:00`)
  base.setDate(base.getDate() + (quote.validDays || 30))
  const diff = base.getTime() - new Date().setHours(12, 0, 0, 0)
  return Math.ceil(diff / 86400000)
}

function timeLabel(value: string) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  const timestamp = parsed.getTime()
  if (Number.isNaN(timestamp)) return '—'

  const diff = Date.now() - timestamp
  if (diff < 0) return formatDate(value)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return formatDate(value)
}
