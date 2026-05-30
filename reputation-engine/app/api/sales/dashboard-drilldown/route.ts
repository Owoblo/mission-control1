import { NextResponse } from 'next/server'
import { compareLeadsByGuidance, getLeadGuidance } from '@/lib/lead-guidance'
import { dateStamp, formatMoney, isClosedLeadStage } from '@/lib/sales'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesOverview } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { listTelephonyCallOutcomes } from '@/lib/server/telephony-monitoring'
import type { CRMLead, CRMQuote, FollowUpLog } from '@/lib/types'

type DashboardDrilldownMetric =
  | 'active_leads'
  | 'quotes_sent_today'
  | 'booked_jobs'
  | 'booked_revenue'
  | 'follow_ups_due'
  | 'hot_close_opportunities'
  | 'pending_deposits'
  | 'calls_today'
  | 'inbound_calls_today'
  | 'outbound_calls_today'
  | 'missed_calls_today'
  | 'failed_calls_today'

type DashboardDrilldownItem = {
  id: string
  kind: 'lead' | 'quote' | 'call'
  href: string
  title: string
  subtitle?: string
  meta?: string
  badge?: string
}

function leadOwnedByUser(lead: CRMLead, user?: { userId?: string | null; name?: string | null } | null) {
  if (!user) return false
  const ownerUserId = lead.assignedRepUserId?.trim()
  const ownerName = lead.assignedRepName?.trim() || lead.assignedRep?.trim()
  return (!!ownerUserId && ownerUserId === user.userId) || (!!ownerName && ownerName === user.name)
}

function buildFollowUpsByLead(followUps: FollowUpLog[]) {
  const map = new Map<string, FollowUpLog[]>()
  for (const item of followUps) {
    if (!item.leadId) continue
    const existing = map.get(item.leadId) || []
    existing.push(item)
    map.set(item.leadId, existing)
  }
  return map
}

function formatLeadRoute(lead: CRMLead) {
  const route = [lead.originCity, lead.destCity].filter(Boolean).join(' -> ')
  return route || lead.moveType || 'Lead'
}

function buildLeadItem(lead: CRMLead, options: { badge?: string; subtitle?: string; meta?: string } = {}): DashboardDrilldownItem {
  return {
    id: lead.id,
    kind: 'lead',
    href: `/sales/leads/${lead.id}`,
    title: lead.name,
    subtitle: options.subtitle || formatLeadRoute(lead),
    meta: options.meta || [lead.moveDate ? `Move ${lead.moveDate}` : '', lead.assignedRepName || lead.assignedRep || 'Unassigned']
      .filter(Boolean)
      .join(' · '),
    badge: options.badge || lead.stage.replace(/_/g, ' '),
  }
}

function buildQuoteMap(quotes: CRMQuote[]) {
  return new Map(quotes.map(quote => [quote.id, quote]))
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const metric = (new URL(request.url).searchParams.get('metric') || '') as DashboardDrilldownMetric
    if (!metric) {
      return NextResponse.json({ error: 'metric is required' }, { status: 400 })
    }

    const { leads, quotes, followUps } = await getSalesOverview()
    const today = dateStamp()
    const quoteMap = buildQuoteMap(quotes)
    const followUpsByLead = buildFollowUpsByLead(followUps)
    const scopedLeads = session?.role === 'sales_rep'
      ? leads.filter(lead => leadOwnedByUser(lead, session) || !lead.assignedRepUserId)
      : leads
    const scopedActiveLeads = scopedLeads.filter(lead => !isClosedLeadStage(lead.stage))
    const guidedLeads = scopedLeads
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

    let title = 'Dashboard Detail'
    let subtitle = ''
    let items: DashboardDrilldownItem[] = []

    if (metric === 'active_leads') {
      title = session?.role === 'sales_rep' ? 'My Active Leads' : 'Active Leads'
      subtitle = `${scopedActiveLeads.length} active lead${scopedActiveLeads.length === 1 ? '' : 's'}`
      items = scopedActiveLeads
        .sort((left, right) => new Date(right.lastTouchedAt || right.createdAt).getTime() - new Date(left.lastTouchedAt || left.createdAt).getTime())
        .map(lead => buildLeadItem(lead, {
          meta: [lead.lastTouchedAt ? `Touched ${lead.lastTouchedAt.slice(0, 10)}` : '', lead.assignedRepName || lead.assignedRep || 'Unassigned']
            .filter(Boolean)
            .join(' · '),
        }))
    } else if (metric === 'quotes_sent_today') {
      const sentToday = quotes
        .filter(quote => quote.sentAt && quote.sentAt.slice(0, 10) === today)
        .sort((left, right) => new Date(right.sentAt || right.createdAt).getTime() - new Date(left.sentAt || left.createdAt).getTime())
      title = 'Quotes Sent Today'
      subtitle = `${sentToday.length} quote${sentToday.length === 1 ? '' : 's'} sent on ${today}`
      items = sentToday.map(quote => {
        const lead = scopedLeads.find(item => item.id === quote.leadId)
        return {
          id: quote.id,
          kind: 'quote',
          href: `/sales/quotes/${quote.id}`,
          title: quote.number,
          subtitle: lead?.name || 'Unlinked lead',
          meta: [quote.sentAt?.slice(11, 16) || '', quote.total ? formatMoney(quote.total) : 'No total']
            .filter(Boolean)
            .join(' · '),
          badge: quote.status,
        }
      })
    } else if (metric === 'booked_jobs' || metric === 'booked_revenue') {
      const bookedLeads = scopedLeads
        .filter(lead => lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success')
        .sort((left, right) => new Date(left.moveDate || left.createdAt).getTime() - new Date(right.moveDate || right.createdAt).getTime())
      title = metric === 'booked_revenue' ? 'Confirmed Revenue' : 'Booked Jobs'
      subtitle = metric === 'booked_revenue'
        ? `${formatMoney(bookedLeads.reduce((sum, lead) => sum + (lead.quoteId ? quoteMap.get(lead.quoteId)?.total || 0 : 0), 0))} across ${bookedLeads.length} job${bookedLeads.length === 1 ? '' : 's'}`
        : `${bookedLeads.length} booked or completed job${bookedLeads.length === 1 ? '' : 's'}`
      items = bookedLeads.map(lead => {
        const quote = lead.quoteId ? quoteMap.get(lead.quoteId) || null : null
        return buildLeadItem(lead, {
          meta: [lead.moveDate ? `Move ${lead.moveDate}` : 'Date TBD', quote?.total ? formatMoney(quote.total) : 'No quote total']
            .filter(Boolean)
            .join(' · '),
        })
      })
    } else if (metric === 'follow_ups_due') {
      const dueLeads = guidedLeads
        .filter(item => item.lead.followUpDate && item.lead.followUpDate <= today)
      title = 'Follow-ups Due'
      subtitle = `${dueLeads.length} lead${dueLeads.length === 1 ? '' : 's'} due today or overdue`
      items = dueLeads.map(({ lead, guidance }) => buildLeadItem(lead, {
        subtitle: guidance.action.nextAction,
        meta: [lead.followUpDate ? `Due ${lead.followUpDate}` : '', guidance.heat.label].filter(Boolean).join(' · '),
        badge: lead.followUpStatus?.replace(/_/g, ' ') || 'follow-up',
      }))
    } else if (metric === 'hot_close_opportunities') {
      const hotClose = guidedLeads.filter(item =>
        item.quote &&
        ['quoted', 'pricing', 'tentative', 'contacted', 'new'].includes(item.lead.stage) &&
        (
          item.guidance.heat.label === 'Hot' ||
          item.guidance.heat.label === 'At Risk' ||
          item.guidance.action.category === 'quote_viewed' ||
          item.guidance.action.category === 'quote_viewed_multi' ||
          item.guidance.action.category === 'deposit_unpaid'
        )
      )
      title = 'Hot Close Opportunities'
      subtitle = `${hotClose.length} lead${hotClose.length === 1 ? '' : 's'} need close-focused follow-up`
      items = hotClose.map(({ lead, quote, guidance }) => buildLeadItem(lead, {
        subtitle: guidance.action.nextAction,
        meta: [quote?.total ? formatMoney(quote.total) : '', guidance.quoteStatusLine].filter(Boolean).join(' · '),
        badge: guidance.heat.label,
      }))
    } else if (metric === 'pending_deposits') {
      const pendingDeposits = guidedLeads.filter(item =>
        item.quote && (item.guidance.action.category === 'deposit_unpaid' || item.guidance.action.category === 'move_date_soon')
      )
      title = 'Pending Deposits'
      subtitle = `${pendingDeposits.length} lead${pendingDeposits.length === 1 ? '' : 's'} waiting on deposit or move-date confirmation`
      items = pendingDeposits.map(({ lead, quote, guidance }) => buildLeadItem(lead, {
        subtitle: guidance.action.nextAction,
        meta: [quote?.total ? formatMoney(quote.total) : '', lead.moveDate ? `Move ${lead.moveDate}` : 'Date TBD'].filter(Boolean).join(' · '),
        badge: guidance.action.category.replace(/_/g, ' '),
      }))
    } else if (
      metric === 'calls_today' ||
      metric === 'inbound_calls_today' ||
      metric === 'outbound_calls_today' ||
      metric === 'missed_calls_today' ||
      metric === 'failed_calls_today'
    ) {
      const direction = metric === 'inbound_calls_today' ? 'inbound' : metric === 'outbound_calls_today' ? 'outbound' : undefined
      const callOutcomes = await listTelephonyCallOutcomes({
        date: today,
        direction,
        missedOnly: metric === 'missed_calls_today',
        failedOnly: metric === 'failed_calls_today',
        limit: 600,
      })
      title = metric === 'calls_today'
        ? 'Calls Today'
        : metric === 'inbound_calls_today'
          ? 'Inbound Calls Today'
          : metric === 'outbound_calls_today'
            ? 'Outbound Calls Today'
            : metric === 'missed_calls_today'
              ? 'Missed Calls Today'
              : 'Failed Calls Today'
      subtitle = `${callOutcomes.length} call${callOutcomes.length === 1 ? '' : 's'} on ${today}`
      items = callOutcomes.map((call, index) => {
        const matchedLead = call.leadId ? leads.find(lead => lead.id === call.leadId) : null
        return {
          id: call.callSid || `${call.ts}-${index}`,
          kind: 'call',
          href: matchedLead?.id ? `/sales/leads/${matchedLead.id}` : '/sales',
          title: matchedLead?.name || call.phone || 'Unknown caller',
          subtitle: [call.direction === 'inbound' ? 'Inbound' : 'Outbound', call.phone].filter(Boolean).join(' · '),
          meta: [call.repName || 'Unassigned', call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : '', call.branchNumber || call.sourceNumber || '']
            .filter(Boolean)
            .join(' · '),
          badge: call.failed ? 'failed' : call.missed ? 'missed' : call.answered ? 'answered' : 'ringing',
        }
      })
    } else {
      return NextResponse.json({ error: `Unsupported metric: ${metric}` }, { status: 400 })
    }

    return NextResponse.json({
      metric,
      title,
      subtitle,
      items,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load dashboard drilldown' },
      { status: 500 }
    )
  }
}
