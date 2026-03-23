import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export interface EmailMessage {
  id: string
  from_address: string
  to_address: string
  subject: string | null
  body_preview: string | null
  body: string | null
  direction: 'inbound' | 'outbound'
  lead_id: string | null
  zoho_message_id: string | null
  created_at: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') || '').toLowerCase().trim()
    if (!email) return NextResponse.json([])

    const { url, headers } = requireSupabaseEnv()
    const encoded = encodeURIComponent(email)
    // Fetch messages where from_address or to_address matches the lead email
    const [inboundRes, outboundRes] = await Promise.all([
      fetch(`${url}/rest/v1/email_messages?from_address=eq.${encoded}&order=created_at.desc&limit=50`, { headers, cache: 'no-store' }),
      fetch(`${url}/rest/v1/email_messages?to_address=eq.${encoded}&order=created_at.desc&limit=50`, { headers, cache: 'no-store' }),
    ])

    const inbound: EmailMessage[] = inboundRes.ok ? await inboundRes.json() : []
    const outbound: EmailMessage[] = outboundRes.ok ? await outboundRes.json() : []

    // Merge, deduplicate by id, sort newest first
    const seen = new Set<string>()
    const merged: EmailMessage[] = []
    for (const msg of [...inbound, ...outbound]) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        merged.push(msg)
      }
    }
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json(merged)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
