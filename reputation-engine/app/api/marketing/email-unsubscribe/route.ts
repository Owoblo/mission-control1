import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
}
function html(message: string, status = 200, token?: string) {
  const form = token ? `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Unsubscribe</button></form>` : ''
  return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head><body style="font-family:Arial,sans-serif;max-width:620px;margin:48px auto;padding:0 20px;line-height:1.5;color:#172033"><h1>Email preferences</h1><p>${escapeHtml(message)}</p>${form}</body></html>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" },
  })
}
async function findContact(token: string | null) {
  if (!token || token.length > 512) return { error: 'Missing or invalid unsubscribe token.', status: 400 } as const
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/market_contacts?email_unsubscribe_token=eq.${encodeURIComponent(token)}&select=id&limit=1`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Preference lookup failed')
  const rows = await response.json() as { id: string }[]
  if (!rows[0]) return { error: 'This unsubscribe link is no longer valid.', status: 404 } as const
  return { contact: rows[0], url, headers } as const
}

// Mail scanners may GET links. Only the explicit form/one-click POST changes preferences.
export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token')
    const result = await findContact(token)
    if ('error' in result) return html(result.error!, result.status)
    return html('Confirm below to stop future partnership outreach.', 200, token!)
  } catch { return html('Could not read subscription preferences. Please try again.', 503) }
}

export async function POST(request: Request) {
  try {
    let token = new URL(request.url).searchParams.get('token')
    if (!token) {
      const form = await request.formData().catch(() => null)
      token = String(form?.get('token') || '') || null
    }
    const result = await findContact(token)
    if ('error' in result) return NextResponse.json({ ok: false, message: result.error }, { status: result.status })
    const { contact, url, headers } = result
    const now = new Date().toISOString()
    // Conditional update is atomic: simultaneous/repeated requests do not append duplicate touches.
    const response = await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(contact.id)}&or=(email_status.is.null,email_status.neq.unsubscribed,cross_channel_suppressed_at.is.null,sequence_paused.is.null,sequence_paused.eq.false)`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ email_status: 'unsubscribed', email_unsubscribed_at: now, cross_channel_suppressed_at: now,
        cross_channel_suppression_reason: 'email_unsubscribe_link', sequence_paused: true }),
    })
    if (!response.ok) throw new Error('Preference update failed')
    const changed = await response.json() as { id: string }[]
    if (changed.length) {
      // Suppression is authoritative even if the ancillary history write is unavailable.
      const touch = await fetch(`${url}/rest/v1/market_touches`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ contact_id: contact.id, channel: 'email', direction: 'inbound', notes: 'Email unsubscribe confirmed.',
          outcome_code: 'opted_out', created_by: 'System', created_at: now, metadata: { source: 'email_unsubscribe_link' } }),
      }).catch(() => null)
      if (!touch?.ok) console.error('Unsubscribe suppression saved; audit touch write failed')
    }
    const message = 'You have been unsubscribed from future partnership outreach emails.'
    if (request.headers.get('accept')?.includes('text/html')) return html(message)
    return NextResponse.json({ ok: true, message }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, message: 'Could not update subscription preferences. Please try again.' }, { status: 503 })
  }
}
