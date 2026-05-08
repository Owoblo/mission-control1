import { NextResponse } from 'next/server'
import {
  getSaturnBranchLabel,
  getSaturnBusinessNumberFromSmsMessage,
  getSaturnTrackingLabel,
  getSmsContactPhone,
  isSaturnBranchPhoneNumber,
  normalizePhone,
} from '@/lib/sales-phones'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { listSalesLeads } from '@/lib/server/sales-repository'

export interface SmsMessage {
  id: string
  from_number: string
  to_number: string
  body: string
  direction: 'inbound' | 'outbound'
  lead_id: string | null
  twilio_sid: string | null
  created_at: string
}

export interface SmsThread {
  contactPhone: string
  messages: SmsMessage[]
  lastMessage: string
  lastAt: string
  unread: boolean
  leadId: string | null
  leadName?: string
  businessNumber: string
  branchLabel: string
  trackingLabel?: string
}

function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filterPhone = searchParams.get('phone') ?? ''

    const { url, headers } = requireSupabaseEnv()

    let endpoint: string
    if (filterPhone) {
      // Return messages for one specific contact, oldest→newest
      const norm = normalizePhone(filterPhone)
      const enc  = encodeURIComponent(norm)
      endpoint = `${url}/rest/v1/sms_messages?select=*&or=(from_number.eq.${enc},to_number.eq.${enc})&order=created_at.asc&limit=500`
    } else {
      endpoint = `${url}/rest/v1/sms_messages?select=*&order=created_at.desc&limit=500`
    }

    const res = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Supabase error: ${text}` }, { status: 500 })
    }
    const msgs = (await res.json()) as SmsMessage[]

    // If phone filter: return flat message list for that thread
    if (filterPhone) {
      return NextResponse.json(msgs)
    }

    const leads = await listSalesLeads().catch(() => [])
    const leadNameById = new Map(leads.map(lead => [lead.id, lead.name]))
    const leadNameByPhone = new Map(
      leads
        .filter(lead => lead.phone)
        .map(lead => [digitsOnly(lead.phone), lead.name] as const)
    )

    // Group by contact phone (the non-Saturn number)
    const threadMap = new Map<string, SmsThread>()
    for (const msg of msgs) {
      const contactPhone = getSmsContactPhone(msg)
      if (!contactPhone || isSaturnBranchPhoneNumber(contactPhone)) continue

      if (!threadMap.has(contactPhone)) {
        threadMap.set(contactPhone, {
          contactPhone,
          messages: [],
          lastMessage: '',
          lastAt: msg.created_at,
          unread: false,
          leadId: msg.lead_id,
          businessNumber: getSaturnBusinessNumberFromSmsMessage(msg),
          branchLabel: getSaturnBranchLabel(getSaturnBusinessNumberFromSmsMessage(msg)),
          trackingLabel: getSaturnTrackingLabel(getSaturnBusinessNumberFromSmsMessage(msg)) || undefined,
        })
      }
      const thread = threadMap.get(contactPhone)!
      thread.messages.push(msg)
      // Keep the most recent non-null lead_id so the thread links to the correct CRM lead
      if (msg.lead_id) thread.leadId = msg.lead_id
      thread.businessNumber = getSaturnBusinessNumberFromSmsMessage(msg)
      thread.branchLabel = getSaturnBranchLabel(thread.businessNumber)
      thread.trackingLabel = getSaturnTrackingLabel(thread.businessNumber) || undefined
    }

    // Sort messages within each thread oldest→newest, set lastMessage
    const threads: SmsThread[] = []
    for (const thread of Array.from(threadMap.values())) {
      thread.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = thread.messages[thread.messages.length - 1]
      thread.lastMessage = last?.body || ''
      thread.lastAt = last?.created_at || thread.lastAt
      thread.unread = last?.direction === 'inbound'
      thread.leadName =
        (thread.leadId ? leadNameById.get(thread.leadId) : null) ||
        leadNameByPhone.get(digitsOnly(thread.contactPhone)) ||
        undefined
      threads.push(thread)
    }

    // Sort threads by most recent message
    threads.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())

    return NextResponse.json(threads)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
