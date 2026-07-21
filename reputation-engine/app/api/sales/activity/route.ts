import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, isBranchScopedManager, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import type { CRMLead } from '@/lib/types'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

interface AnalyticsEvent {
  id: string
  event_type: string
  lead_id: string | null
  rep_id: string | null
  ts: string
  properties: Record<string, unknown>
}

interface LeadRow {
  id: string
  data: {
    name?: string
    phone?: string
    lastTouchedByName?: string
    lastTouchedByUserId?: string
    assignedRepName?: string
    assignedRepUserId?: string
    branch?: CRMLead['branch']
    originCity?: string
    originAddress?: string
    destCity?: string
    destAddress?: string
  } | null
}

const HIDDEN_ACTIVITY_TYPES = new Set([
  'telephony_presence',
  'telephony_dialer_event',
  'telephony_call_outcome',
])

const CUSTOMER_ACTIVITY_TYPES = new Set([
  'quote_viewed',
  'quote_accepted',
  'quote_declined',
  'sms_received',
])

const LEAD_FALLBACK_ACTIVITY_TYPES = new Set([
  'lead_created',
  'lead_stage_changed',
  'lead_lost',
  'lead_assigned',
  'job_booked',
  'consultation_completed',
  'quote_created',
  'quote_sent',
  'note_added',
  'follow_up_scheduled',
  'job_outcome_recorded',
])

const EVENT_LABELS: Record<string, string> = {
  lead_created:           'claimed a new lead',
  lead_stage_changed:     'moved a lead',
  lead_lost:              'marked a lead as lost',
  lead_assigned:          'assigned a lead',
  job_booked:             '🎉 booked a move',
  call_completed:         'made a call',
  voicemail_left:         'left a voicemail',
  consultation_completed: 'completed a consultation',
  quote_created:          'created a quote',
  quote_sent:             'sent a quote',
  quote_viewed:           'quote was viewed',
  quote_accepted:         '✅ quote was accepted',
  quote_declined:         'quote was declined',
  sms_sent:               'sent a text',
  sms_received:           'received a text',
  email_sent:             'sent an email',
  note_added:             'added a note',
  follow_up_scheduled:    'scheduled a follow-up',
  job_outcome_recorded:   'recorded job outcome',
}

const EVENT_ICONS: Record<string, string> = {
  lead_created:           '🟢',
  lead_stage_changed:     '↗️',
  lead_lost:              '❌',
  lead_assigned:          '👤',
  job_booked:             '🎉',
  call_completed:         '📞',
  voicemail_left:         '📬',
  consultation_completed: '📋',
  quote_created:          '📄',
  quote_sent:             '💰',
  quote_viewed:           '👁',
  quote_accepted:         '✅',
  quote_declined:         '❌',
  sms_sent:               '💬',
  sms_received:           '📩',
  email_sent:             '✉️',
  note_added:             '📝',
  follow_up_scheduled:    '📅',
  job_outcome_recorded:   '📊',
}

function buildDetail(type: string, props: Record<string, unknown>): string {
  switch (type) {
    case 'lead_stage_changed': {
      const prev = props.lead_prev_stage as string | undefined
      const next = props.lead_stage as string | undefined
      if (prev && next) return `${stageLabel(prev)} → ${stageLabel(next)}`
      if (next) return `→ ${stageLabel(next)}`
      return ''
    }
    case 'quote_sent':
    case 'quote_accepted':
    case 'quote_created': {
      const total = props.quote_total as number | undefined
      if (total) return `$${total.toLocaleString()}`
      return ''
    }
    case 'call_completed': {
      const dur = props.call_duration_seconds as number | undefined
      if (dur) {
        const m = Math.floor(dur / 60)
        const s = dur % 60
        return m > 0 ? `${m}m ${s}s` : `${s}s`
      }
      return ''
    }
    case 'sms_sent':
    case 'sms_received': {
      const len = props.message_length as number | undefined
      return len ? `${len} chars` : ''
    }
    case 'job_booked': {
      const total = props.quote_total as number | undefined
      return total ? `$${total.toLocaleString()}` : ''
    }
    case 'lead_lost': {
      const reason = props.lost_reason as string | undefined
      return reason || ''
    }
    default:
      return ''
  }
}

function stageLabel(s: string) {
  const map: Record<string, string> = {
    new: 'New',
    contacted: 'Contacted',
    estimate_scheduled: 'Est. Scheduled',
    estimate_completed: 'Est. Done',
    pricing: 'Building Quote',
    quoted: 'Quote Sent',
    tentative: 'Tentative',
    nurture: 'Shopping Around',
    booked: 'Booked',
    completed: 'Move Completed',
    customer_success: 'Customer Success',
    lost: 'Lost',
  }
  return map[s] || s
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const days   = Math.min(parseInt(url.searchParams.get('days') || '1'), 90)
    const repId  = url.searchParams.get('repId') || ''
    const type   = url.searchParams.get('type') || ''
    const limit  = Math.min(parseInt(url.searchParams.get('limit') || '300'), 500)

    const { url: sbUrl, headers } = requireSupabaseEnv()
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

    // Reps can only see their own activity
    const effectiveRepId = session?.role === 'sales_rep'
      ? (session.userId || repId)
      : repId

    let query = `${sbUrl}/rest/v1/analytics_events?ts=gte.${encodeURIComponent(cutoff)}&order=ts.desc&limit=${limit}`
    if (effectiveRepId) query += `&rep_id=eq.${encodeURIComponent(effectiveRepId)}`
    if (type) {
      query += `&event_type=eq.${encodeURIComponent(type)}`
    } else {
      query += `&event_type=not.in.(${Array.from(HIDDEN_ACTIVITY_TYPES).map(eventType => encodeURIComponent(eventType)).join(',')})`
    }

    const eventsRes = await fetch(query, { headers })
    const events: AnalyticsEvent[] = await eventsRes.json().catch(() => [])
    const visibleEvents = type
      ? events
      : events.filter(event => !HIDDEN_ACTIVITY_TYPES.has(event.event_type))

    // Batch-fetch lead names
    const leadIds = Array.from(new Set(visibleEvents.map(e => e.lead_id).filter(Boolean) as string[]))
    const nameMap = new Map<string, string>()
    const leadActorMap = new Map<string, { userId?: string; name?: string }>()
    const scopedLeadIds = new Set<string>()
    if (leadIds.length > 0) {
      const leadsRes = await fetch(
        `${sbUrl}/rest/v1/crm_leads?id=in.(${leadIds.map(id => `"${id}"`).join(',')})&select=id,data&deleted=eq.false`,
        { headers }
      )
      const leadRows: LeadRow[] = await leadsRes.json().catch(() => [])
      leadRows.forEach(r => {
        if (r.data?.name) nameMap.set(r.id, r.data.name)
        leadActorMap.set(r.id, {
          userId: r.data?.lastTouchedByUserId || r.data?.assignedRepUserId,
          name: r.data?.lastTouchedByName || r.data?.assignedRepName,
        })
        if (r.data && leadMatchesSessionBranch({ id: r.id, name: r.data.name || '', stage: 'new', createdAt: '', inventory: [], mediaAssets: [], callLogs: [], ...r.data }, session)) {
          scopedLeadIds.add(r.id)
        }
      })
    }

    // Enrich reps — build rep name map from properties
    const repNames = new Map<string, string>()
    visibleEvents.forEach(ev => {
      const props = ev.properties || {}
      const id = ev.rep_id || (props.actor_user_id as string | undefined) || null
      const name =
        (props.actor_name as string | undefined) ||
        (props.assigned_by_name as string | undefined) ||
        (props.userName as string | undefined) ||
        (props.assigned_rep as string | undefined)
      if (id && name && !repNames.has(id)) repNames.set(id, name)
    })

    // Format events
    const items = visibleEvents
      .filter(ev => !isBranchScopedManager(session) || Boolean(ev.lead_id && scopedLeadIds.has(ev.lead_id)))
      .map(ev => {
      const leadName = ev.lead_id ? (nameMap.get(ev.lead_id) || null) : null
      const props    = ev.properties || {}
      const leadActor = ev.lead_id ? leadActorMap.get(ev.lead_id) : null
      const explicitActorName =
        (props.actor_name as string | undefined) ||
        (props.assigned_by_name as string | undefined) ||
        null
      const explicitActorUserId =
        ev.rep_id ||
        (props.actor_user_id as string | undefined) ||
        null
      const automationActor = props.automation_actor as string | undefined
      const allowLeadFallback = LEAD_FALLBACK_ACTIVITY_TYPES.has(ev.event_type)

      let repId: string | null = explicitActorUserId
      let repName: string | null = explicitActorName

      if (!repName && CUSTOMER_ACTIVITY_TYPES.has(ev.event_type)) {
        repName = 'Customer'
        repId = null
      } else if (!repName && automationActor === 'automation') {
        repName = 'Automation'
        repId = 'automation'
      } else if (!repName && allowLeadFallback) {
        repId = repId || leadActor?.userId || null
        repName = leadActor?.name || (repId ? repNames.get(repId) : null) || 'System'
      } else if (!repName) {
        repName = (repId ? repNames.get(repId) : null) || 'Unknown rep'
      }

      return {
        id:      ev.id,
        type:    ev.event_type,
        icon:    EVENT_ICONS[ev.event_type] || '·',
        label:   EVENT_LABELS[ev.event_type] || ev.event_type,
        detail:  buildDetail(ev.event_type, props),
        repId,
        repName,
        leadId:  ev.lead_id,
        leadName,
        ts:      ev.ts,
        props,
      }
    })

    // Summary stats (always for today regardless of range filter)
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const todayItems = items.filter(i => new Date(i.ts) >= todayStart)

    const summary = {
      total:         todayItems.length,
      quotes_sent:   todayItems.filter(i => i.type === 'quote_sent').length,
      calls:         todayItems.filter(i => i.type === 'call_completed').length,
      sms_sent:      todayItems.filter(i => i.type === 'sms_sent').length,
      bookings:      todayItems.filter(i => i.type === 'job_booked').length,
      leads_claimed: todayItems.filter(i => i.type === 'lead_created').length,
      stage_changes: todayItems.filter(i => i.type === 'lead_stage_changed').length,
    }

    // Rep breakdown for today
    const repActivity: Record<string, { name: string; count: number; types: Record<string, number> }> = {}
    todayItems.forEach(item => {
      if (!item.repId || item.repName === 'System' || item.repName === 'Customer' || item.repName === 'Automation' || item.repName === 'Unknown rep') return
      if (!repActivity[item.repId]) repActivity[item.repId] = { name: item.repName, count: 0, types: {} }
      repActivity[item.repId].count++
      repActivity[item.repId].types[item.type] = (repActivity[item.repId].types[item.type] || 0) + 1
    })

    return NextResponse.json({ items, summary, repActivity })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
