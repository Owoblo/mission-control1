import { NextResponse } from 'next/server'
import { displayEmailSubject } from '@/lib/email-display'
import { decorateInboundLead, getInboundStatus, parseInboundRawData } from '@/lib/inbound-inbox'
import {
  getSaturnBranchLabel,
  getSaturnBranchNumberFromRawData,
  getSaturnTrackingLabel,
} from '@/lib/sales-phones'
import { findMatchingActiveLead } from '@/lib/server/lead-identity'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { parseSalesAlertNote } from '@/lib/server/sales-alerts'
import { isInboundLeadUnread, isSalesEmailUnread } from '@/lib/server/inbox-state'
import { getSessionUser } from '@/lib/server/session'
import { listAllInboundLeads, listFollowUpLogs, listSalesEmails, listSalesLeads } from '@/lib/server/sales-repository'
import { buildSmsThreads, listSmsMessages } from '@/lib/server/sms-threads'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'

export interface NotificationItem {
  id: string
  type: 'lead' | 'sms' | 'email' | 'alert'
  source?: string           // for leads: twilio_call, twilio_sms, etc.
  title: string
  preview: string
  time: string
  leadId: string | null
  phone: string | null
  branchLabel?: string
  trackingLabel?: string
  href: string
  priority: 'interrupt' | 'today' | 'monitor' | 'record'
  reason: string
  requiredAction: string
  dedupeKey: string
}

type NotificationsPayload = {
  items: NotificationItem[]
  breakdown: { leads: number; sms: number; emails: number; alerts: number }
  totalCount: number
}

const NOTIFICATIONS_CACHE_TTL_MS = 10_000
const notificationsCache = new Map<string, { expiresAt: number; payload: NotificationsPayload }>()
const NOTIFICATION_DISPOSITION_TYPE = 'notification_disposition'

async function listAcknowledgedKeys(userId: string) {
  const { url, headers } = requireSupabaseEnv()
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const response = await fetch(`${url}/rest/v1/analytics_events?select=properties,ts&event_type=eq.${NOTIFICATION_DISPOSITION_TYPE}&rep_id=eq.${encodeURIComponent(userId)}&ts=gte.${encodeURIComponent(cutoff)}&order=ts.desc&limit=500`, { headers, cache: 'no-store' })
  if (!response.ok) return new Set<string>()
  const rows = await response.json() as Array<{ properties?: { dedupeKey?: string } }>
  return new Set(rows.map(row => row.properties?.dedupeKey).filter((key): key is string => Boolean(key)))
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_call:   'Inbound call',
  twilio_sms:    'Inbound SMS',
  facebook_dm:   'Facebook DM',
  instagram_dm:  'Instagram DM',
  email:         'Inbound email',
  direct_mail:   'QR / direct-mail inquiry',
  website_form:  'Web form inquiry',
  zapier:        'Lead form inquiry',
}

function getLeadPreviewLabel(source: string, raw: Record<string, unknown> | null) {
  if (source !== 'twilio_call') return SOURCE_LABELS[source] || source
  const dialCallStatus = typeof raw?.dialCallStatus === 'string' ? raw.dialCallStatus.toLowerCase() : ''
  const missedCall = raw?.missedCall === true || ['no-answer', 'busy', 'failed', 'canceled'].includes(dialCallStatus)
  return missedCall ? 'Missed call' : 'Inbound call'
}

function formatNotificationPhone(value?: string | null) {
  if (!value) return null
  const d = value.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return value
}

export async function GET() {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ items: [], totalCount: 0, breakdown: { leads: 0, sms: 0, emails: 0, alerts: 0 } })
  }

  const cacheKey = [session?.userId || session?.name || 'user', session?.role || 'role', session?.branch || 'all'].join(':')
  const cached = notificationsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload)
  }

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

  const [allInboundLeads, crmLeads, allEmails, followUpLogs, smsMessages, acknowledgedKeys] = await Promise.all([
    listAllInboundLeads().catch(() => [] as Awaited<ReturnType<typeof listAllInboundLeads>>),
    listSalesLeads().catch(() => [] as Awaited<ReturnType<typeof listSalesLeads>>),
    listSalesEmails().catch(() => [] as Awaited<ReturnType<typeof listSalesEmails>>),
    listFollowUpLogs().catch(() => [] as Awaited<ReturnType<typeof listFollowUpLogs>>),
    listSmsMessages().catch(() => []),
    listAcknowledgedKeys(session.userId || session.name || 'unknown').catch(() => new Set<string>()),
  ])

  // ── 1. Unclaimed inbound leads ──────────────────────────────────────────
  // Filter out shortcode/OTP senders (e.g. UHaul +84285) — these are never real customers
  function isRealCustomerPhone(phone: string | null | undefined) {
    if (!phone) return true  // no phone = could be web form, keep
    const digits = phone.replace(/\D/g, '')
    return digits.length >= 10  // shortcodes have < 10 digits
  }

  const leadIdByInboundId = new Map(
    crmLeads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead.id] as const)
  )
  const hydratedInbound = allInboundLeads.map(item => decorateInboundLead({
    ...item,
    linkedLeadId: leadIdByInboundId.get(item.id),
  }))
  const openSmsLeadPhones = new Set(
    hydratedInbound
      .filter(item => item.source === 'twilio_sms' && getInboundStatus(item) === 'needs_action')
      .map(item => (item.phone || '').replace(/\D/g, ''))
      .filter(Boolean)
  )
  const openEmailContacts = new Set(
    hydratedInbound
      .filter(item => item.source === 'email' && getInboundStatus(item) === 'needs_action')
      .flatMap(item => {
        const raw = parseInboundRawData(item.raw_data)
        return [
          (item.email || '').trim().toLowerCase(),
          (typeof raw?.from === 'string' ? raw.from : '').trim().toLowerCase(),
        ]
      })
      .filter(Boolean)
  )

  const leadItems: NotificationItem[] = hydratedInbound
    .filter(l => getInboundStatus(l) === 'needs_action' && isRealCustomerPhone(l.phone))
    .filter(l => isInboundLeadUnread(l))
    .map(l => {
      const raw = parseInboundRawData(l.raw_data)
      const matchedLead = findMatchingActiveLead(crmLeads, l.phone, l.email)
      const branchNumber = getSaturnBranchNumberFromRawData(raw)
      const branchLabel =
        getSaturnBranchLabel(branchNumber) ||
        (typeof raw?.branchCity === 'string' ? raw.branchCity : '') ||
        undefined
      const trackingLabel =
        (typeof raw?.trackingLabel === 'string' ? raw.trackingLabel : '') ||
        getSaturnTrackingLabel(branchNumber) ||
        undefined
      const inboundName = l.name?.trim()
      // Use actual phone number as title when name is unknown — much more useful than "New Caller"
      const phoneTitle = formatNotificationPhone(l.phone)
      const name = inboundName && !/^unknown/i.test(inboundName)
        ? inboundName
        : matchedLead?.name?.trim()
          ? matchedLead.name
        : phoneTitle
          ?? (l.source === 'twilio_call' ? 'Unknown Caller' : l.source === 'twilio_sms' ? 'Unknown Contact' : 'New Inquiry')
      // Don't include branchLabel here — the component already prepends it to avoid duplication
      const previewParts = [getLeadPreviewLabel(l.source, raw), trackingLabel].filter(Boolean)
      const missedCall = getLeadPreviewLabel(l.source, raw) === 'Missed call'
      return {
        id: l.id,
        type: 'lead' as const,
        source: l.source,
        title: name,
        preview: previewParts.join(' • '),
        time: l.created_at,
        leadId: matchedLead?.id || null,
        phone: l.phone || null,
        branchLabel,
        trackingLabel,
        href: matchedLead?.id ? `/sales/leads/${matchedLead.id}` : '/sales/inbox',
        priority: missedCall ? 'interrupt' as const : 'today' as const,
        reason: missedCall ? 'A customer attempted to call and did not reach the team.' : 'New incoming demand has not been handled.',
        requiredAction: missedCall ? 'Return the call' : 'Review and assign',
        dedupeKey: `inbound:${l.id}`,
      }
    })

  // ── 2. SMS threads where last message is inbound (customer awaiting reply) ─
  const smsItems: NotificationItem[] = buildSmsThreads(smsMessages, crmLeads, allInboundLeads)
    .filter(thread => thread.unread)
    .filter(thread => Date.now() - new Date(thread.lastAt).getTime() <= 7 * 24 * 60 * 60 * 1000)
    .filter(thread => !openSmsLeadPhones.has((thread.contactPhone || '').replace(/\D/g, '')))
    .map(thread => ({
      id: `sms-${thread.contactPhone}`,
      type: 'sms' as const,
      source: 'twilio_sms',
      title: thread.leadName || formatNotificationPhone(thread.contactPhone) || thread.contactPhone,
      preview: thread.lastMessage?.slice(0, 120) || 'SMS received',
      time: thread.lastAt,
      leadId: thread.leadId,
      phone: thread.contactPhone,
      branchLabel: thread.branchLabel || undefined,
      trackingLabel: thread.trackingLabel,
      href: thread.leadId ? `/sales/leads/${thread.leadId}` : `/sales/inbox?tab=sms&phone=${encodeURIComponent(thread.contactPhone)}`,
      priority: 'today' as const,
      reason: 'The latest customer message has no later team response.',
      requiredAction: 'Reply to customer',
      dedupeKey: `sms:${thread.contactPhone}`,
    }))

  // ── 3. Inbound emails from last 48 h ────────────────────────────────────
  const emailItems: NotificationItem[] = allEmails
    .filter(em => em.direction === 'inbound' && new Date(em.sentAt) > cutoff)
    .filter(isSalesEmailUnread)
    .filter(em => !openEmailContacts.has((em.from || '').trim().toLowerCase()))
    .map(em => ({
      id: `email-${em.id}`,
      type: 'email' as const,
      source: 'email',
      title: em.from,
      preview: displayEmailSubject(em.subject),
      time: em.sentAt,
      leadId: em.leadId || null,
      phone: null,
      href: em.leadId ? `/sales/leads/${em.leadId}` : `/sales/inbox?tab=email&id=${encodeURIComponent(em.id)}`,
      priority: 'today' as const,
      reason: 'An unread customer email needs review.',
      requiredAction: 'Review email',
      dedupeKey: `email:${em.id}`,
    }))

  const alertItems: NotificationItem[] = followUpLogs
    .filter(log => new Date(log.date || log.createdAt || 0) > cutoff)
    .map(log => {
      const parsed = parseSalesAlertNote(log.notes)
      if (!parsed) return null
      if (parsed.title === 'Missed call needs callback') return null
      return {
        id: `alert-${log.id}`,
        type: 'alert' as const,
        source: 'system_alert',
        title: parsed.title,
        preview: parsed.preview,
        time: log.date || log.createdAt,
        leadId: log.leadId || null,
        phone: null,
        branchLabel: parsed.title.match(/—\s+(.+?)\s+line$/)?.[1],
        href: log.leadId ? `/sales/leads/${log.leadId}` : '/sales/inbox',
        priority: 'interrupt' as const,
        reason: parsed.preview,
        requiredAction: 'Resolve alert',
        dedupeKey: `alert:${log.id}`,
      }
    })
    .filter(Boolean) as NotificationItem[]

  const leadById = new Map(crmLeads.map(lead => [lead.id, lead]))
  const visibleToSession = (item: NotificationItem) => {
    const lead = item.leadId ? leadById.get(item.leadId) : null
    if (session?.branch && lead?.branch && lead.branch !== session.branch) return false
    if (session?.role !== 'sales_rep' || !lead) return true
    const ownerId = lead.assignedRepUserId
    const ownerName = lead.assignedRepName || lead.assignedRep
    return (!ownerId && !ownerName) || ownerId === session.userId || ownerName === session.name
  }
  const seen = new Set<string>()
  const allItems = [...alertItems, ...leadItems, ...smsItems, ...emailItems]
    .filter(visibleToSession)
    .filter(item => !acknowledgedKeys.has(item.dedupeKey))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .filter(item => seen.has(item.dedupeKey) ? false : (seen.add(item.dedupeKey), true))
    .slice(0, 40)

  const payload: NotificationsPayload = {
    items: allItems,
    breakdown: { leads: leadItems.length, sms: smsItems.length, emails: emailItems.length, alerts: alertItems.length },
    totalCount: leadItems.length + smsItems.length + emailItems.length + alertItems.length,
  }
  notificationsCache.set(cacheKey, { expiresAt: Date.now() + NOTIFICATIONS_CACHE_TTL_MS, payload })

  return NextResponse.json(payload)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { dedupeKeys?: string[]; action?: 'acknowledged' | 'resolved' }
  const dedupeKeys = Array.from(new Set((body.dedupeKeys || []).map(key => key.trim()).filter(Boolean))).slice(0, 100)
  if (!dedupeKeys.length) return NextResponse.json({ error: 'At least one notification key is required' }, { status: 400 })
  const now = new Date().toISOString()
  const { url, headers } = requireSupabaseEnv()
  const rows = dedupeKeys.map(dedupeKey => ({
    id: uid('ev'), event_type: NOTIFICATION_DISPOSITION_TYPE, rep_id: session.userId || session.name,
    ts: now, created_at: now, properties: { dedupeKey, action: body.action || 'acknowledged', userName: session.name },
  }))
  const response = await fetch(`${url}/rest/v1/analytics_events`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(rows), cache: 'no-store' })
  if (!response.ok) return NextResponse.json({ error: 'Notification acknowledgement could not be saved' }, { status: 502 })
  notificationsCache.clear()
  return NextResponse.json({ ok: true, count: rows.length })
}
