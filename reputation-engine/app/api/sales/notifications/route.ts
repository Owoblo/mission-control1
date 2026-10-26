import { createHash } from 'node:crypto'
import { fetchWithReadDeadline as fetch } from '@/lib/resilient-read'
import { nurtureReminderDue } from '@/lib/nurture-policy'
import { NextResponse } from 'next/server'
import { displayEmailSubject } from '@/lib/email-display'
import { decorateInboundLead, getInboundStatus, parseInboundRawData, needsHumanInboundAttention } from '@/lib/inbound-inbox'
import {
  getSaturnBranchLabel,
  getSaturnBranchNumberFromRawData,
  getSaturnTrackingLabel,
  getSalesBranchFromSaturnPhone,
} from '@/lib/sales-phones'
import { findMatchingActiveLead } from '@/lib/server/lead-identity'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import type { CRMLead } from '@/lib/types'
import { parseSalesAlertNote } from '@/lib/server/sales-alerts'
import { isInboundLeadUnread, isSalesEmailUnread } from '@/lib/server/inbox-state'
import { getSessionUser } from '@/lib/server/session'
import { listAllInboundLeads, listNurtureNotificationLeads, listFollowUpLogs, listSalesEmails, listSalesLeadInboxSnapshots, listContractorPriceResponseLeads } from '@/lib/server/sales-repository'
import { buildSmsThreads, listSmsMessages } from '@/lib/server/sms-threads'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid, detectSalesBranchFromLocation } from '@/lib/sales'

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
  branch?: CRMLead['branch']
}

type NotificationsPayload = {
  items: NotificationItem[]
  breakdown: { leads: number; sms: number; emails: number; alerts: number }
  totalCount: number
}

const NOTIFICATIONS_CACHE_TTL_MS = 30_000
const notificationsCache = new Map<string, { expiresAt: number; payload: NotificationsPayload }>()
let sourceSnapshot: { expiresAt: number; value: Awaited<ReturnType<typeof readNotificationSources>> } | undefined
let sourcePending: ReturnType<typeof readNotificationSources> | undefined
let sourceRetryAfter = 0
async function readNotificationSources() {
  const sources = await Promise.all([listAllInboundLeads(), listSalesLeadInboxSnapshots(), listSalesEmails(), listFollowUpLogs(), listSmsMessages(), listNurtureNotificationLeads().then(leads => leads.filter(lead => nurtureReminderDue(lead))), listContractorPriceResponseLeads(new Date(Date.now() - 48 * 60 * 60 * 1000))])
  // The inbox projection intentionally contains only the latest 300 leads.
  // Resolve the scope of older alert subjects before applying permissions.
  const cutoff = Date.now() - 48 * 60 * 60 * 1000
  const known = new Set(sources[1].map(lead => lead.id))
  const ids = [...new Set([
    ...sources[2].filter(email => Date.parse(email.sentAt) > cutoff).map(email => email.leadId),
    ...sources[3].filter(log => Date.parse(log.date || log.createdAt) > cutoff).map(log => log.leadId),
    ...sources[4].filter(message => Date.parse(message.created_at) > cutoff).map(message => message.lead_id),
    ...sources[5].map(lead => lead.id), ...sources[6].map(row => row.id),
  ].filter((id): id is string => typeof id === 'string' && !known.has(id)))]
  const { url, headers } = requireSupabaseEnv()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const fields = ['name','phone','email','stage','branch','assignedRep','assignedRepName','assignedRepUserId','originCity','originAddress','destCity','destAddress','mergedIntoLeadId']
    const query = new URLSearchParams({ select: ['id', ...fields.map(field => `${field}:data->>${field}`)].join(','), id: `in.(${ids.slice(offset, offset + 100).join(',')})`, deleted: 'eq.false', limit: '100' })
    const response = await fetch(`${url}/rest/v1/crm_leads?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw Error('Notification permissions could not be verified')
    const leads = await response.json() as CRMLead[]
    sources[1].push(...leads.filter(lead => !lead.mergedIntoLeadId))
  }
  return sources
}
async function getNotificationSources() {
  if (sourceSnapshot && sourceSnapshot.expiresAt > Date.now()) return sourceSnapshot.value
  if (sourcePending) return sourcePending
  if (Date.now() < sourceRetryAfter) throw new Error('Notification refresh cooling down')
  sourcePending = readNotificationSources().then(value => {
    sourceSnapshot = { value, expiresAt: Date.now() + 60_000 }
    return value
  }).catch(error => { sourceRetryAfter = Date.now() + 30_000; throw error }).finally(() => { sourcePending = undefined })
  return sourcePending
}

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
  try { return await loadNotifications() } catch {
    return NextResponse.json({ error: 'Notifications are temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
    })
  }
}

async function loadNotifications() {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ items: [], totalCount: 0, breakdown: { leads: 0, sms: 0, emails: 0, alerts: 0 } })
  }

  const cacheKey = [session?.userId || session?.name || 'user', session?.role || 'role', session?.branch || 'all'].join(':')
  const cached = notificationsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload)
  }

  // Notifications are a current work surface, not an archive counter.
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)

  const [[allInboundLeads, crmLeads, allEmails, followUpLogs, smsMessages, nurtureLeads, contractorPriceLeads], acknowledgedKeys] = await Promise.all([
    getNotificationSources(),
    listAcknowledgedKeys(session.userId || session.name || 'unknown'),
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
    .filter(l => needsHumanInboundAttention(parseInboundRawData(l.raw_data)) || isInboundLeadUnread(l))
    .filter(l => new Date(l.created_at) > cutoff)
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
      const humanAttention = needsHumanInboundAttention(raw)
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
        priority: missedCall || humanAttention ? 'interrupt' as const : 'today' as const,
        reason: missedCall ? 'A customer attempted to call and did not reach the team.' : 'New incoming demand has not been handled.',
        requiredAction: missedCall ? 'Return the call' : 'Review and assign',
        dedupeKey: `inbound:${l.id}`,
        branch: getSalesBranchFromSaturnPhone(branchNumber),
      }
    })

  // ── 2. SMS threads where last message is inbound (customer awaiting reply) ─
  const smsItems: NotificationItem[] = buildSmsThreads(smsMessages, crmLeads, allInboundLeads)
    .filter(thread => thread.unread)
    .filter(thread => new Date(thread.lastAt) > cutoff)
    .filter(thread => !openSmsLeadPhones.has((thread.contactPhone || '').replace(/\D/g, '')))
    .map(thread => ({
      id: `sms-${thread.contactPhone}:${thread.messages.filter(message => message.direction === 'inbound').at(-1)?.id || thread.lastAt}`,
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
      dedupeKey: `sms:${thread.contactPhone}:${thread.messages.filter(message => message.direction === 'inbound').at(-1)?.id || thread.lastAt}`,
      branch: getSalesBranchFromSaturnPhone(thread.businessNumber),
    }))

  // ── 3. Inbound emails from last 48 h ────────────────────────────────────
  const emailItems: NotificationItem[] = allEmails
    .filter(em => em.direction === 'inbound' && new Date(em.sentAt) > cutoff)
    .filter(em => em.templateType !== 'health_check' && em.templateType !== 'partnership_inbound')
    .filter(em => em.from?.trim().toLowerCase() !== 'leadflow.health@system.invalid')
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
        priority: parsed.severity === 'critical' ? 'interrupt' as const : 'today' as const,
        reason: parsed.preview,
        requiredAction: 'Resolve alert',
        dedupeKey: `alert:${log.id}`,
      }
    })
    .filter(Boolean) as NotificationItem[]

  const nurtureItems: NotificationItem[] = nurtureLeads
    .filter(lead => (!session.branch || lead.branch === session.branch) && (session.role !== 'sales_rep' || (lead.assignedRepUserId ? lead.assignedRepUserId === session.userId : (lead.assignedRepName || lead.assignedRep) === session.name)))
    .map(lead => ({
      id: `nurture:${lead.id}:${lead.followUpDate}`, type: 'alert', source: 'nurture_reminder',
      title: `Nurture check-in: ${lead.name}`, preview: `Check-in due ${lead.followUpDate}. Expected move: ${lead.moveDate || 'needs confirmation'}.`,
      time: `${lead.followUpDate}T14:00:00.000Z`, leadId: lead.id, phone: lead.phone || null,
      href: `/sales/leads/${lead.id}`, priority: 'today', reason: 'The scheduled Nurture check-in is due.',
      requiredAction: 'Log check-in and schedule next', dedupeKey: `nurture:${lead.id}:${lead.followUpDate}`,
    }))
  const contractorPriceItems: NotificationItem[] = contractorPriceLeads.flatMap(row => {
    const lead = row.data
    if (session.branch && lead.branch && lead.branch !== session.branch) return []
    if (session.role === 'sales_rep' && (lead.assignedRepUserId ? lead.assignedRepUserId !== session.userId : lead.assignedRepName && lead.assignedRepName !== session.name)) return []
    return (lead.contractorScopeReviews || []).flatMap(review => (review.pricing?.events || [])
      .filter(event => event.actor === 'contractor' && new Date(event.at) > cutoff)
      .map(event => {
        const action = event.action === 'submit' ? 'submitted a bid' : event.action === 'counter' ? 'sent a counteroffer' : event.action === 'accept' ? 'accepted your offer' : event.action === 'decline' ? 'declined the job' : 'responded to the job offer'
        const amount = typeof event.price?.amount === 'number' ? `${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(event.price.amount)}${event.price.mode === 'hourly' ? '/hour' : ''}` : ''
        const details = event.price?.notes || event.notes || ''
        return {
          id: `contractor-price:${lead.id}:${review.id}:${event.id}`,
          type: 'alert' as const,
          source: 'contractor_price',
          title: `${review.scope?.contactName || 'Contractor'} ${action}`,
          preview: [amount, details].filter(Boolean).join(' · ').slice(0, 240) || 'Open the contractor response to review details.',
          time: event.at,
          leadId: lead.id,
          phone: null,
          href: `/sales/contractors?leadId=${encodeURIComponent(lead.id)}`,
          priority: 'interrupt' as const,
          reason: 'A contractor submitted a price or responded to an offer.',
          requiredAction: 'Review contractor response',
          dedupeKey: `contractor-price:${lead.id}:${review.id}:${event.id}`,
        }
      }))
  })
  const leadById = new Map(crmLeads.map(lead => [lead.id, lead]))
  const visibleToSession = (item: NotificationItem) => {
    const lead = item.leadId ? leadById.get(item.leadId) : null
    const branch = lead ? lead.branch || detectSalesBranchFromLocation(lead.originCity, lead.originAddress, lead.destCity, lead.destAddress) : item.branch
    if (session.branch && branch !== session.branch) return false
    if (session?.role !== 'sales_rep' || !lead) return true
    const ownerId = lead.assignedRepUserId
    const ownerName = lead.assignedRepName || lead.assignedRep
    return (!ownerId && !ownerName) || ownerId === session.userId || ownerName === session.name
  }
  const seen = new Set<string>()
  const allItems = [...contractorPriceItems, ...nurtureItems, ...alertItems, ...leadItems, ...smsItems, ...emailItems]
    .filter(visibleToSession)
    .filter(item => !acknowledgedKeys.has(item.dedupeKey))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .filter(item => seen.has(item.dedupeKey) ? false : (seen.add(item.dedupeKey), true))
    .slice(0, 40)

  const payload: NotificationsPayload = {
    items: allItems,
    breakdown: {
      leads: allItems.filter(item => item.type === 'lead').length,
      sms: allItems.filter(item => item.type === 'sms').length,
      emails: allItems.filter(item => item.type === 'email').length,
      alerts: allItems.filter(item => item.type === 'alert').length,
    },
    totalCount: allItems.length,
  }
  notificationsCache.set(cacheKey, { expiresAt: Date.now() + NOTIFICATIONS_CACHE_TTL_MS, payload })

  return NextResponse.json(payload)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { dedupeKeys?: string[]; action?: 'displayed' | 'opened' | 'acknowledged' | 'resolved'; surface?: string; notificationPermission?: string; audioState?: string }
  const action = body.action || 'acknowledged'
  if (!['displayed','opened','acknowledged','resolved'].includes(action)) return NextResponse.json({ error: 'Invalid notification action' }, { status: 400 })
  const dedupeKeys = Array.from(new Set((Array.isArray(body.dedupeKeys) ? body.dedupeKeys : []).filter((key): key is string => typeof key === 'string').map(key => key.trim()).filter(key => key && key.length <= 300))).slice(0, 100)
  if (!dedupeKeys.length) return NextResponse.json({ error: 'At least one notification key is required' }, { status: 400 })
  const now = new Date().toISOString()
  const { url, headers } = requireSupabaseEnv()
  const rows = dedupeKeys.map(dedupeKey => ({
    id: `notif_${createHash('sha256').update(`${session.userId || session.name}:${action}:${dedupeKey}`).digest('hex')}`, event_type: action === 'displayed' ? 'notification_displayed' : NOTIFICATION_DISPOSITION_TYPE, rep_id: session.userId || session.name,
    ts: now, created_at: now, properties: { dedupeKey, action, userName: session.name, ...(action === 'displayed' ? { surface: body.surface === 'toast' ? 'toast' : 'bell', notificationPermission: ['granted','denied','default','unsupported'].includes(body.notificationPermission || '') ? body.notificationPermission : 'unknown', audioState: ['running','suspended','closed','unavailable'].includes(body.audioState || '') ? body.audioState : 'unknown', evidenceSource: 'authenticated_browser_report' } : {}) },
  }))
  const response = await fetch(`${url}/rest/v1/analytics_events?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows), cache: 'no-store' })
  if (!response.ok) return NextResponse.json({ error: 'Notification acknowledgement could not be saved' }, { status: 502 })
  notificationsCache.clear()
  return NextResponse.json({ ok: true, count: rows.length })
}
