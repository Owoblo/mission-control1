import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

// Public endpoint — no auth required (scanned by mail recipient on their phone)
// GET /api/marketing/qr/[contactId]
// Marks contact as "engaged", logs a touch, then redirects to website
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params
  if (!contactId) return NextResponse.redirect('https://starmovers.ca')

  const { url, headers } = requireSupabaseEnv()

  // Fetch the contact to check current stage
  const contactRes = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${contactId}&select=id,stage,name,tracking_code`,
    { headers, cache: 'no-store' }
  )
  const [contact] = contactRes.ok
    ? ((await contactRes.json()) as { id: string; stage: string; name: string; tracking_code: string }[])
    : []

  if (contact) {
    const now = new Date().toISOString()

    // Only advance stage if not already warm+
    const ADVANCE_STAGES = new Set(['cold', 'contacted'])
    const newStage = ADVANCE_STAGES.has(contact.stage) ? 'engaged' : contact.stage

    // Update contact stage + last_touch
    await fetch(`${url}/rest/v1/market_contacts?id=eq.${contactId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ stage: newStage, last_touch_at: now }),
    })

    // Log the touch
    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contactId,
        channel: 'direct_mail',
        direction: 'inbound',
        notes: `QR code scanned from direct mail letter (tracking: ${contact.tracking_code ?? 'n/a'})`,
        created_by: 'system',
        created_at: now,
      }),
    })

    // If they were cold/contacted, also add a HOT queue item for same-day follow-up
    if (ADVANCE_STAGES.has(contact.stage)) {
      // Check if there's already a pending queue item
      const existingRes = await fetch(
        `${url}/rest/v1/market_queue?contact_id=eq.${contactId}&status=eq.pending&limit=1`,
        { headers, cache: 'no-store' }
      )
      const existing = existingRes.ok ? ((await existingRes.json()) as unknown[]) : []

      if (existing.length === 0) {
        const today = new Date().toISOString().slice(0, 10)
        await fetch(`${url}/rest/v1/market_queue`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            contact_id: contactId,
            step_number: 0,
            channel: 'phone',
            due_date: today,
            label: 'QR scan follow-up call',
            message_draft: `${contact.name ?? 'This contact'} scanned your direct mail QR code today — call them now while you're top of mind.`,
            status: 'pending',
          }),
        })
      }
    }
  }

  // Redirect to website (or a landing page)
  return NextResponse.redirect('https://starmovers.ca', { status: 302 })
}
