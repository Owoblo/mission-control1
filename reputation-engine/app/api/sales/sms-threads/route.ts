import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

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
}

const MY_NUMBER = '+12267732993'

function normalizePhone(p: string) {
  const d = (p || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return p.startsWith('+') ? p : `+${d}`
}

export async function GET() {
  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/sms_messages?select=*&order=created_at.desc&limit=500`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Supabase error: ${text}` }, { status: 500 })
    }
    const msgs = (await res.json()) as SmsMessage[]

    // Group by contact phone (the non-Saturn number)
    const threadMap = new Map<string, SmsThread>()
    for (const msg of msgs) {
      const contactPhone = normalizePhone(
        msg.direction === 'inbound' ? msg.from_number : msg.to_number
      )
      if (!contactPhone || contactPhone === MY_NUMBER) continue

      if (!threadMap.has(contactPhone)) {
        threadMap.set(contactPhone, {
          contactPhone,
          messages: [],
          lastMessage: '',
          lastAt: msg.created_at,
          unread: false,
          leadId: msg.lead_id,
        })
      }
      const thread = threadMap.get(contactPhone)!
      thread.messages.push(msg)
    }

    // Sort messages within each thread oldest→newest, set lastMessage
    const threads: SmsThread[] = []
    for (const thread of Array.from(threadMap.values())) {
      thread.messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = thread.messages[thread.messages.length - 1]
      thread.lastMessage = last?.body || ''
      thread.lastAt = last?.created_at || thread.lastAt
      thread.unread = last?.direction === 'inbound'
      threads.push(thread)
    }

    // Sort threads by most recent message
    threads.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())

    return NextResponse.json(threads)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
