import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

function html(message: string) {
  return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head><body style="font-family:Arial,sans-serif;max-width:620px;margin:48px auto;padding:0 20px;line-height:1.5;color:#172033"><h1 style="font-size:24px">Email preferences updated</h1><p>${message}</p></body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

async function unsubscribe(token: string | null) {
  if (!token) return { ok: false, status: 400, message: 'Missing unsubscribe token.' }
  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()
  const response = await fetch(`${url}/rest/v1/market_contacts?email_unsubscribe_token=eq.${encodeURIComponent(token)}&select=id,email&limit=1`, {
    headers,
    cache: 'no-store',
  })
  if (!response.ok) return { ok: false, status: 500, message: 'Could not read subscription preferences.' }
  const rows = await response.json() as { id: string; email: string | null }[]
  const contact = rows[0]
  if (!contact) return { ok: false, status: 404, message: 'This unsubscribe link is no longer valid.' }

  await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contact.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        email_status: 'unsubscribed',
        email_unsubscribed_at: now,
        cross_channel_suppressed_at: now,
        cross_channel_suppression_reason: 'email_unsubscribe_link',
        sequence_paused: true,
      }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: 'email',
        direction: 'inbound',
        notes: 'Email unsubscribe link clicked.',
        outcome_code: 'opted_out',
        created_by: 'System',
        created_at: now,
        metadata: { source: 'email_unsubscribe_link' },
      }),
    }),
  ])

  return { ok: true, status: 200, message: 'You have been unsubscribed from future partnership outreach emails.' }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const result = await unsubscribe(token)
  return html(result.message)
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  let token = url.searchParams.get('token')
  if (!token) {
    const body = await request.formData().catch(() => null)
    token = String(body?.get('token') || '') || null
  }
  const result = await unsubscribe(token)
  return NextResponse.json({ ok: result.ok, message: result.message }, { status: result.status })
}
