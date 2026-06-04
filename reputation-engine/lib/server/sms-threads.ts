import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnBranchLabel,
  getSaturnBusinessNumberFromSmsMessage,
  getSaturnTrackingLabel,
  getSmsContactPhone,
  isSaturnBranchPhoneNumber,
  normalizePhone,
} from '@/lib/sales-phones'
import { normalizeLeadIdentityPhone, sortLeadIdentityMatches } from '@/lib/server/lead-identity'
import { getInboundLeadLatestActivityAt, getInboundInboxChannelState } from '@/lib/server/inbox-state'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, InboundLead } from '@/lib/types'

export interface SmsMessageRecord {
  id: string
  from_number: string
  to_number: string
  body: string
  direction: 'inbound' | 'outbound'
  lead_id: string | null
  twilio_sid: string | null
  media_count?: number | null
  created_at: string
}

export interface SalesSmsThread {
  contactPhone: string
  messages: SmsMessageRecord[]
  lastMessage: string
  lastAt: string
  lastDirection: 'inbound' | 'outbound'
  unread: boolean
  unreadCount: number
  leadId: string | null
  inboundLeadId?: string | null
  leadName?: string
  leadStage?: CRMLead['stage']
  businessNumber: string
  branchLabel: string
  trackingLabel?: string
  lastReadAt?: string
  lastReadByName?: string
  lastActionAt?: string
  lastActionByName?: string
}

const HEALTH_PROBE_SMS_DIGITS = '15550001111'

type InboundLeadSmsThreadEntry = {
  direction?: unknown
  body?: unknown
  messageSid?: unknown
  at?: unknown
}

function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

function isInternalHealthProbeSmsMessage(message: SmsMessageRecord) {
  const body = (message.body || '').toLowerCase()
  const fromDigits = digitsOnly(message.from_number)
  const toDigits = digitsOnly(message.to_number)
  const sid = (message.twilio_sid || '').trim()

  if (sid.startsWith('HC_SMS_')) return true
  if (body.includes('lead flow health sms probe')) return true

  return fromDigits === HEALTH_PROBE_SMS_DIGITS || toDigits === HEALTH_PROBE_SMS_DIGITS
}

function sortLeadMatches(leads: CRMLead[]) {
  return sortLeadIdentityMatches(leads)
}

function buildLeadPhoneIndex(leads: CRMLead[]) {
  const index = new Map<string, CRMLead[]>()
  for (const lead of leads) {
    const digits = digitsOnly(normalizeLeadIdentityPhone(lead.identityPhone || lead.phone))
    if (!digits) continue
    const bucket = index.get(digits) || []
    bucket.push(lead)
    index.set(digits, bucket)
  }
  for (const [key, bucket] of Array.from(index.entries())) {
    index.set(key, sortLeadMatches(bucket))
  }
  return index
}

function findLeadByPhone(phone: string, leadsByPhone: Map<string, CRMLead[]>) {
  const digits = digitsOnly(normalizeLeadIdentityPhone(phone))
  if (!digits) return null
  const exact = leadsByPhone.get(digits)
  if (exact?.length) return exact[0]

  for (const [candidateDigits, bucket] of Array.from(leadsByPhone.entries())) {
    if (
      candidateDigits === digits ||
      candidateDigits.endsWith(digits) ||
      digits.endsWith(candidateDigits)
    ) {
      return bucket[0] || null
    }
  }

  return null
}

export async function listSmsMessages(filterPhone?: string, filterLeadId?: string) {
  const { url, headers } = requireSupabaseEnv()
  const normalizedPhone = normalizePhone(filterPhone)
  const digits10 = normalizedPhone ? normalizedPhone.replace(/^\+1/, '') : ''

  let messages: SmsMessageRecord[] = []

  if (normalizedPhone) {
      const endpoint = `${url}/rest/v1/sms_messages?select=*&or=(from_number.eq.${encodeURIComponent(normalizedPhone)},to_number.eq.${encodeURIComponent(normalizedPhone)},from_number.eq.${encodeURIComponent(digits10)},to_number.eq.${encodeURIComponent(digits10)})&order=created_at.asc&limit=2000`
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Supabase error: ${detail || response.status}`)
    }
    messages = (await response.json()) as SmsMessageRecord[]
  }

  if (filterLeadId) {
    const endpoint = `${url}/rest/v1/sms_messages?select=*&lead_id=eq.${encodeURIComponent(filterLeadId)}&order=created_at.asc&limit=2000`
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (response.ok) {
      const byLead = (await response.json()) as SmsMessageRecord[]
      // Merge, deduplicating by id
      const seen = new Set(messages.map(m => m.id))
      for (const m of byLead) {
        if (!seen.has(m.id)) {
          seen.add(m.id)
          messages.push(m)
        }
      }
      messages.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
  }

  if (!normalizedPhone && !filterLeadId) {
    const endpoint = `${url}/rest/v1/sms_messages?select=*&order=created_at.desc&limit=2000`
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Supabase error: ${detail || response.status}`)
    }
    messages = (await response.json()) as SmsMessageRecord[]
  }

  return messages.filter(message => !isInternalHealthProbeSmsMessage(message))
}

function getLatestInboundAt(messages: SmsMessageRecord[]) {
  return messages
    .filter(message => message.direction === 'inbound')
    .map(message => message.created_at)
    .sort()
    .pop()
}

function readInboundLeadSmsThread(inbound: InboundLead) {
  const raw = typeof inbound.raw_data === 'object' && inbound.raw_data ? inbound.raw_data as Record<string, unknown> : {}
  return {
    branchNumber: typeof raw.to === 'string' ? normalizePhone(raw.to) : '',
    entries: Array.isArray(raw.smsThread) ? raw.smsThread as InboundLeadSmsThreadEntry[] : [],
  }
}

export function mergeInboundLeadSmsThreadMessages(
  messages: SmsMessageRecord[],
  inboundLeads: InboundLead[] = [],
  filterPhone?: string
) {
  const merged = [...messages]
  const seenSids = new Set(
    messages
      .map(message => (message.twilio_sid || '').trim())
      .filter(Boolean)
  )
  const seenFallbackIds = new Set(messages.map(message => message.id))
  const filterDigits = digitsOnly(normalizePhone(filterPhone))

  for (const inbound of inboundLeads) {
    if (inbound.source !== 'twilio_sms') continue
    const inboundPhone = normalizePhone(inbound.phone)
    if (!inboundPhone) continue
    if (filterDigits && digitsOnly(inboundPhone) !== filterDigits) continue

    const { branchNumber, entries } = readInboundLeadSmsThread(inbound)
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const body = typeof entry.body === 'string' ? entry.body.trim() : ''
      if (!body) continue
      const twilioSid = typeof entry.messageSid === 'string' ? entry.messageSid.trim() : ''
      if (twilioSid && seenSids.has(twilioSid)) continue

      const createdAt = typeof entry.at === 'string' && entry.at
        ? entry.at
        : inbound.created_at
      const fallbackId = `inbound-lead-${inbound.id}-${twilioSid || index}`
      if (seenFallbackIds.has(fallbackId)) continue

      if (twilioSid) seenSids.add(twilioSid)
      seenFallbackIds.add(fallbackId)
      const direction: SmsMessageRecord['direction'] = entry.direction === 'outbound' ? 'outbound' : 'inbound'
      const businessNumber = branchNumber || DEFAULT_SATURN_BRANCH_NUMBER
      merged.push({
        id: fallbackId,
        from_number: direction === 'inbound' ? inboundPhone : businessNumber,
        to_number: direction === 'inbound' ? businessNumber : inboundPhone,
        body,
        direction,
        lead_id: null,
        twilio_sid: twilioSid || null,
        created_at: createdAt,
      })
    }
  }

  merged.sort((left, right) => left.created_at.localeCompare(right.created_at))
  return merged
}

export function buildSmsThreads(messages: SmsMessageRecord[], leads: CRMLead[], inboundLeads: InboundLead[] = []) {
  messages = mergeInboundLeadSmsThreadMessages(messages, inboundLeads)
  const leadsById = new Map(leads.map(lead => [lead.id, lead]))
  const leadsByPhone = buildLeadPhoneIndex(leads)
  const inboundByPhone = new Map<string, InboundLead>()
  const threadMap = new Map<string, SalesSmsThread>()

  for (const inbound of inboundLeads) {
    const digits = digitsOnly(inbound.phone)
    if (!digits || inbound.source !== 'twilio_sms') continue
    const current = inboundByPhone.get(digits)
    if (!current || getInboundLeadLatestActivityAt(inbound) > getInboundLeadLatestActivityAt(current)) {
      inboundByPhone.set(digits, inbound)
    }
  }

  for (const message of messages) {
    const contactPhone = getSmsContactPhone(message)
    if (!contactPhone || isSaturnBranchPhoneNumber(contactPhone)) continue

    if (!threadMap.has(contactPhone)) {
      threadMap.set(contactPhone, {
        contactPhone,
        messages: [],
        lastMessage: '',
        lastAt: message.created_at,
        lastDirection: message.direction,
        unread: false,
        unreadCount: 0,
        leadId: null,
        inboundLeadId: null,
        businessNumber: getSaturnBusinessNumberFromSmsMessage(message),
        branchLabel: getSaturnBranchLabel(getSaturnBusinessNumberFromSmsMessage(message)),
        trackingLabel: getSaturnTrackingLabel(getSaturnBusinessNumberFromSmsMessage(message)) || undefined,
      })
    }

    const thread = threadMap.get(contactPhone)!
    thread.messages.push(message)
    thread.businessNumber = getSaturnBusinessNumberFromSmsMessage(message)
    thread.branchLabel = getSaturnBranchLabel(thread.businessNumber)
    thread.trackingLabel = getSaturnTrackingLabel(thread.businessNumber) || undefined
  }

  const threads: SalesSmsThread[] = []
  for (const thread of Array.from(threadMap.values())) {
    thread.messages.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())

    const last = thread.messages[thread.messages.length - 1]
    const messageLeadIds = thread.messages
      .map(message => message.lead_id)
      .filter((value): value is string => !!value)
      .reverse()
    const directLead = messageLeadIds.map(id => leadsById.get(id)).find(Boolean) || null
    const phoneMatchedLead = findLeadByPhone(thread.contactPhone, leadsByPhone)
    const resolvedLead = directLead || phoneMatchedLead
    const inboundLead = inboundByPhone.get(digitsOnly(thread.contactPhone)) || null
    const leadState = resolvedLead?.inboxState?.sms
    const inboundState = inboundLead ? getInboundInboxChannelState(inboundLead, undefined, 'sms') : undefined
    const state = leadState || inboundState
    const latestInboundAt = getLatestInboundAt(thread.messages)
    const lastOutboundAt = thread.messages
      .filter(message => message.direction === 'outbound')
      .map(message => message.created_at)
      .sort()
      .pop()
    const acknowledgedAt = [state?.lastReadAt, lastOutboundAt]
      .filter((value): value is string => !!value)
      .sort()
      .pop()

    thread.leadId = resolvedLead?.id || directLead?.id || null
    thread.inboundLeadId = inboundLead?.id || null
    thread.leadName = resolvedLead?.name || undefined
    thread.leadStage = resolvedLead?.stage
    thread.lastMessage = last?.body || ''
    thread.lastAt = last?.created_at || thread.lastAt
    thread.lastDirection = last?.direction || 'outbound'
    thread.lastReadAt = state?.lastReadAt
    thread.lastReadByName = state?.lastReadByName
    thread.lastActionAt = state?.lastActionAt
    thread.lastActionByName = state?.lastActionByName
    thread.unreadCount = thread.messages.filter(message => {
      if (message.direction !== 'inbound') return false
      if (!acknowledgedAt) return true
      return new Date(message.created_at).getTime() > new Date(acknowledgedAt).getTime()
    }).length
    thread.unread = !!latestInboundAt && thread.unreadCount > 0
    threads.push(thread)
  }

  threads.sort((left, right) => new Date(right.lastAt).getTime() - new Date(left.lastAt).getTime())
  return threads
}
