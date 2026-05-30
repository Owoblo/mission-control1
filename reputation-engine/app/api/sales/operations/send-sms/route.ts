/**
 * POST /api/sales/operations/send-sms
 * Sends an SMS from the operations number (+12267746581).
 */
import { NextResponse } from 'next/server'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { twilioAuth } from '@/lib/server/twilio-recordings'

const OPS_NUMBER = '+12267746581'

async function saveSentSms(to: string, body: string, sid: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        from_number: OPS_NUMBER,
        to_number: to,
        body,
        direction: 'outbound',
        lead_id: null,
        twilio_sid: sid || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch { /* non-fatal */ }
}

export async function POST(request: Request) {
  try {
    const { to, body, mediaUrls } = (await request.json()) as { to?: string; body?: string; mediaUrls?: string[] }
    if (!to) {
      return NextResponse.json({ error: 'to is required' }, { status: 400 })
    }

    const accountSid = readEnv('TWILIO_ACCOUNT_SID')
    const authToken = readEnv('TWILIO_AUTH_TOKEN')
    if (!accountSid || !authToken) {
      return NextResponse.json({ error: 'Twilio not configured' }, { status: 500 })
    }

    const bodyText = (body || '').trim()
    const params = new URLSearchParams({ From: OPS_NUMBER, To: to })
    // Twilio requires Body OR MediaUrl — include Body only if non-empty
    if (bodyText) params.set('Body', bodyText)
    else if (!mediaUrls?.length) params.set('Body', ' ') // fallback for empty sends
    if (mediaUrls?.length) {
      mediaUrls.forEach(url => params.append('MediaUrl', url))
    }
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: twilioAuth(accountSid, authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    )

    const result = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; error_message?: string }
    if (!res.ok || !result.sid) {
      return NextResponse.json({ error: result.message || result.error_message || 'Send failed' }, { status: 400 })
    }

    const mediaText = mediaUrls?.length ? `\n[MMS: ${mediaUrls.join(', ')}]` : ''
    await saveSentSms(to, (body || '').trim() + mediaText, result.sid || '')
    return NextResponse.json({ ok: true, sid: result.sid })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
