import { isClosedLeadStage } from '@/lib/sales'
import {
  getSaturnBranchLabel,
  getSaturnBusinessNumberFromSmsMessage,
  getSaturnTrackingLabel,
  getSmsContactPhone,
  isSaturnBranchPhoneNumber,
  normalizePhone,
} from '@/lib/sales-phones'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead } from '@/lib/types'

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
  leadName?: string
  leadStage?: CRMLead['stage']
  businessNumber: string
  branchLabel: string
  trackingLabel?: string
}

function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

function getLeadRecencyTimestamp(lead: CRMLead) {
  return new Date(lead.lastTouchedAt || lead.createdAt || 0).getTime()
}

function sortLeadMatches(leads: CRMLead[]) {
  return [...leads].sort((left, right) => {
    const leftClosed = isClosedLeadStage(left.stage)
    const rightClosed = isClosedLeadStage(right.stage)
    if (leftClosed !== rightClosed) return leftClosed ? 1 : -1
    return getLeadRecencyTimestamp(right) - getLeadRecencyTimestamp(left)
  })
}

function buildLeadPhoneIndex(leads: CRMLead[]) {
  const index = new Map<string, CRMLead[]>()
  for (const lead of leads) {
    const digits = digitsOnly(lead.phone)
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
  const digits = digitsOnly(phone)
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
    const endpoint = `${url}/rest/v1/sms_messages?select=*&or=(from_number.eq.${encodeURIComponent(normalizedPhone)},to_number.eq.${encodeURIComponent(normalizedPhone)},from_number.eq.${encodeURIComponent(digits10)},to_number.eq.${encodeURIComponent(digits10)})&order=created_at.asc&limit=500`
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Supabase error: ${detail || response.status}`)
    }
    messages = (await response.json()) as SmsMessageRecord[]
  }

  if (filterLeadId) {
    const endpoint = `${url}/rest/v1/sms_messages?select=*&lead_id=eq.${encodeURIComponent(filterLeadId)}&order=created_at.asc&limit=500`
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
    const endpoint = `${url}/rest/v1/sms_messages?select=*&order=created_at.desc&limit=500`
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Supabase error: ${detail || response.status}`)
    }
    messages = (await response.json()) as SmsMessageRecord[]
  }

  return messages
}

export function buildSmsThreads(messages: SmsMessageRecord[], leads: CRMLead[]) {
  const leadsById = new Map(leads.map(lead => [lead.id, lead]))
  const leadsByPhone = buildLeadPhoneIndex(leads)
  const threadMap = new Map<string, SalesSmsThread>()

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

    thread.leadId = resolvedLead?.id || directLead?.id || null
    thread.leadName = resolvedLead?.name || undefined
    thread.leadStage = resolvedLead?.stage
    thread.lastMessage = last?.body || ''
    thread.lastAt = last?.created_at || thread.lastAt
    thread.lastDirection = last?.direction || 'outbound'
    thread.unread = thread.lastDirection === 'inbound'
    thread.unreadCount = thread.messages.filter(message => message.direction === 'inbound').length
    threads.push(thread)
  }

  threads.sort((left, right) => new Date(right.lastAt).getTime() - new Date(left.lastAt).getTime())
  return threads
}
