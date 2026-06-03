import { NextResponse } from 'next/server'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { instantlyEventToTouch } from '@/lib/server/instantly'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import type { InstantlyWebhookEvent } from '@/lib/server/instantly'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = readEnv('INSTANTLY_WEBHOOK_SECRET')
  if (secret) {
    const sig = request.headers.get('x-instantly-signature') ?? ''
    if (sig !== secret) return new Response('Unauthorized', { status: 401 })
  }

  let event: InstantlyWebhookEvent
  try {
    event = await request.json() as InstantlyWebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = event.lead_email ?? event.lead?.email ?? ''
  if (!email) return NextResponse.json({ ok: true, skipped: 'no_email' })

  const { url, headers } = requireSupabaseEnv()

  // Find the contact by email
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?email=eq.${encodeURIComponent(email)}&select=id,name,company,stage,sequence_paused&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [contact] = contactRes.ok ? await contactRes.json() as Record<string, unknown>[] : []

  if (!contact) {
    return NextResponse.json({ ok: true, skipped: 'contact_not_found' })
  }

  const contactId = contact.id as string
  const touch = instantlyEventToTouch(event)
  const now = event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString()

  // Log the touch
  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: contactId,
      channel: touch.channel,
      direction: touch.direction,
      notes: touch.notes,
      outcome_code: touch.outcome_code,
      created_by: 'Instantly',
      created_at: now,
      metadata: touch.metadata,
    }),
  })

  // Update instantly_status on the contact
  const statusMap: Record<string, string> = {
    email_sent: 'sent',
    email_opened: 'opened',
    email_clicked: 'clicked',
    email_replied: 'replied',
    email_bounced: 'bounced',
    unsubscribed: 'unsubscribed',
  }
  const newInstantlyStatus = statusMap[event.event_type] ?? null

  await fetch(`${url}/rest/v1/market_contacts?id=eq.${contactId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      last_touch_at: now,
      ...(newInstantlyStatus ? { instantly_status: newInstantlyStatus } : {}),
    }),
  })

  // If replied — pause sequence and fire rep alert
  if (event.event_type === 'email_replied') {
    await pausePartnershipSequenceForInbound({
      channel: 'email',
      email,
      occurredAt: now,
      notes: `Replied via Instantly: ${event.subject ?? '(no subject)'}`,
      metadata: { source: 'instantly', campaign_id: event.campaign_id },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, event_type: event.event_type, contact_id: contactId })
}
