/**
 * POST /api/sales/operations/send-sms
 * Sends an SMS from the operations number (+12267746581).
 *
 * Uses the one logged send path: lib/server/sales-messaging.sendSalesMessage.
 * The ops number is passed as a deliberate fromNumberOverride so branch-number
 * resolution can never silently swap the sender.
 */
import { NextResponse } from 'next/server'
import { sendSalesMessage } from '@/lib/server/sales-messaging'

const OPS_NUMBER = '+12267746581'

export async function POST(request: Request) {
  try {
    const { to, body, mediaUrls } = (await request.json()) as { to?: string; body?: string; mediaUrls?: string[] }
    if (!to) {
      return NextResponse.json({ error: 'to is required' }, { status: 400 })
    }

    const bodyText = (body || '').trim()
    const result = await sendSalesMessage({
      channel: 'sms',
      to,
      // Twilio requires Body OR MediaUrl — keep the old fallback for empty sends.
      body: bodyText || (mediaUrls?.length ? '' : ' '),
      mediaUrls,
      fromNumberOverride: OPS_NUMBER,
      actor: 'human',
      notes: `Operations SMS sent to ${to}`,
    })

    if (result.result?.blocked) {
      return NextResponse.json({ error: `SMS blocked — ${String(result.result.reason || 'safety guard')}` }, { status: 400 })
    }

    return NextResponse.json({ ok: true, sid: result.result?.sid || null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed'
    const status = /twilio|missing/i.test(message) ? 500 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
