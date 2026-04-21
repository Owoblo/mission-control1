import { NextResponse } from 'next/server'
import {
  getSaturnBranchLabel,
  getSaturnBranchNumberFromRawData,
  getSaturnTrackingLabel,
  getSmsContactPhone,
  getSaturnBusinessNumberFromSmsMessage,
  isSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { parseSalesAlertNote } from '@/lib/server/sales-alerts'
import { hasInternalSession } from '@/lib/server/session'
import { listFollowUpLogs, listInboundLeads, listSalesEmails } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

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
}

const SOURCE_LABELS: Record<string, string> = {
  twilio_call:   'Missed call',
  twilio_sms:    'Inbound SMS',
  facebook_dm:   'Facebook DM',
  instagram_dm:  'Instagram DM',
  email:         'Inbound email',
  website_form:  'Web form inquiry',
}

export async function GET() {
  if (!await hasInternalSession()) {
    return NextResponse.json({ items: [], totalCount: 0, breakdown: { leads: 0, sms: 0, emails: 0, alerts: 0 } })
  }

  const { url, headers } = requireSupabaseEnv()

  const [inboundLeads, allEmails, followUpLogs, smsRes] = await Promise.all([
    listInboundLeads().catch(() => [] as Awaited<ReturnType<typeof listInboundLeads>>),
    listSalesEmails().catch(() => [] as Awaited<ReturnType<typeof listSalesEmails>>),
    listFollowUpLogs().catch(() => [] as Awaited<ReturnType<typeof listFollowUpLogs>>),
    fetch(`${url}/rest/v1/sms_messages?select=*&order=created_at.desc&limit=400`, {
      headers, cache: 'no-store',
    }),
  ])

  // ── 1. Unclaimed inbound leads ──────────────────────────────────────────
  const leadItems: NotificationItem[] = inboundLeads
    .filter(l => !l.claimed)
    .map(l => {
      const raw = typeof l.raw_data === 'object' && l.raw_data ? l.raw_data as Record<string, unknown> : null
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
      const name = inboundName && !/^unknown/i.test(inboundName)
        ? inboundName
        : l.source === 'twilio_call' ? 'New Caller'
        : l.source === 'twilio_sms'  ? 'New Contact'
        : 'New Inquiry'
      return {
        id: l.id,
        type: 'lead' as const,
        source: l.source,
        title: name,
        preview: `${SOURCE_LABELS[l.source] || l.source}${branchLabel ? ` • ${branchLabel}` : ''}${trackingLabel ? ` • ${trackingLabel}` : ''}`,
        time: l.created_at,
        leadId: null,
        phone: l.phone || null,
        branchLabel,
        trackingLabel,
        href: '/sales/inbox',
      }
    })

  // ── 2. SMS threads where last message is inbound (customer awaiting reply) ─
  const smsItems: NotificationItem[] = []
  if (smsRes.ok) {
    type SmsMsg = {
      id: string
      from_number: string
      to_number: string
      body: string
      direction: 'inbound' | 'outbound'
      lead_id: string | null
      created_at: string
    }
    const msgs = (await smsRes.json()) as SmsMsg[]

    const threadMap = new Map<string, { msgs: SmsMsg[]; leadId: string | null; branchNumber: string | null }>()
    for (const msg of msgs) {
      const contactPhone = getSmsContactPhone(msg)
      if (!contactPhone || isSaturnBranchPhoneNumber(contactPhone)) continue
      if (!threadMap.has(contactPhone)) {
        threadMap.set(contactPhone, {
          msgs: [],
          leadId: msg.lead_id,
          branchNumber: getSaturnBusinessNumberFromSmsMessage(msg),
        })
      }
      threadMap.get(contactPhone)!.msgs.push(msg)
      // Always update to the most recent non-null lead_id
      if (msg.lead_id) threadMap.get(contactPhone)!.leadId = msg.lead_id
      threadMap.get(contactPhone)!.branchNumber = getSaturnBusinessNumberFromSmsMessage(msg)
    }

    for (const [phone, thread] of Array.from(threadMap.entries())) {
      thread.msgs.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      const last = thread.msgs[thread.msgs.length - 1]
      if (!last || last.direction !== 'inbound') continue  // only awaiting-reply threads
      // Ignore if older than 7 days (likely stale)
      if (Date.now() - new Date(last.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) continue

      smsItems.push({
        id: `sms-${phone}`,
        type: 'sms',
        source: 'twilio_sms',
        title: thread.leadId ? phone : phone,
        preview: last.body?.slice(0, 120) || 'SMS received',
        time: last.created_at,
        leadId: thread.leadId,
        phone,
        branchLabel: getSaturnBranchLabel(thread.branchNumber),
        trackingLabel: getSaturnTrackingLabel(thread.branchNumber) || undefined,
        href: thread.leadId ? `/sales/leads/${thread.leadId}` : '/sales/inbox',
      })
    }
  }

  // ── 3. Inbound emails from last 48 h ────────────────────────────────────
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const emailItems: NotificationItem[] = allEmails
    .filter(em => em.direction === 'inbound' && new Date(em.sentAt) > cutoff)
    .map(em => ({
      id: `email-${em.id}`,
      type: 'email' as const,
      source: 'email',
      title: em.from,
      preview: em.subject || '(no subject)',
      time: em.sentAt,
      leadId: em.leadId || null,
      phone: null,
      href: em.leadId ? `/sales/leads/${em.leadId}` : '/sales/inbox',
    }))

  const alertItems: NotificationItem[] = followUpLogs
    .filter(log => new Date(log.date || log.createdAt || 0) > cutoff)
    .map(log => {
      const parsed = parseSalesAlertNote(log.notes)
      if (!parsed) return null
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
      }
    })
    .filter(Boolean) as NotificationItem[]

  const allItems = [...alertItems, ...leadItems, ...smsItems, ...emailItems]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 40)

  return NextResponse.json({
    items: allItems,
    breakdown: { leads: leadItems.length, sms: smsItems.length, emails: emailItems.length, alerts: alertItems.length },
    totalCount: leadItems.length + smsItems.length + emailItems.length + alertItems.length,
  })
}
