import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/server/rate-limit'
import { sendInternalAlertSms, sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { getWorkerSharedSecret, requireSupabaseEnv } from '@/lib/server/runtime'

const JOHN_NUMBER = '+12267241730'
const BUSINESS_NUMBER = '+12267732993'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function POST(request: Request) {
  const internalSecret = request.headers.get('x-internal-secret')
  const isHealthCheck = request.headers.get('x-health-check') === '1' && internalSecret === getWorkerSharedSecret()
  const ip = getClientIp(request)
  const { allowed, retryAfterMs } = rateLimit(`capture:${ip}`, 10, 60_000)
  if (!isHealthCheck && !allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { ...corsHeaders, 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    )
  }

  try {
    const body = (await request.json()) as {
      name?: string
      phone?: string
      email?: string
      address?: string
      estimateMin?: number
      estimateMax?: number
      inventorySummary?: string
      crewSize?: number
      healthCheck?: boolean
    }

    const { name = '', phone = '', email = '', address = '', estimateMin, estimateMax, inventorySummary, crewSize } = body

    if (!name.trim() && !phone.trim() && !email.trim()) {
      return NextResponse.json(
        { error: 'Please provide your name or contact info' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { url, headers } = requireSupabaseEnv()
    const leadId = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    const message = [
      address ? `Moving from: ${address}` : '',
      inventorySummary ? `Items: ${inventorySummary}` : '',
      estimateMin && estimateMax ? `Estimate shown: $${estimateMin}–$${estimateMax} + HST` : '',
      crewSize ? `Suggested crew: ${crewSize} movers` : '',
    ]
      .filter(Boolean)
      .join(' | ')

    const saveRes = await fetch(`${url}/rest/v1/inbound_leads`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: leadId,
        source: isHealthCheck ? 'health_check_form' : 'free_quote_qr',
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        message,
        raw_data: {
          address,
          estimateMin,
          estimateMax,
          inventorySummary,
          crewSize,
          channel: 'qr_direct_mail',
        },
        claimed: isHealthCheck,
        claimed_at: isHealthCheck ? createdAt : null,
        created_at: createdAt,
      }),
    })

    if (!saveRes.ok) {
      const err = await saveRes.text()
      throw new Error(`Supabase error: ${err}`)
    }

    const estText  = estimateMin && estimateMax ? `$${estimateMin}–$${estimateMax}` : 'N/A'
    const smsText  = `🏠 QR Quote Lead: ${name || 'Unknown'} | ${phone || 'no phone'} | ${address || 'no addr'} | Est: ${estText} | ${email || 'no email'}`
    const emailSubject = `🏠 New QR Quote Lead: ${name || 'Unknown'} — ${address || 'no address'}`
    const emailBody = [
      `New lead from the free-quote QR page:`,
      ``,
      `Name:    ${name || '—'}`,
      `Phone:   ${phone || '—'}`,
      `Email:   ${email || '—'}`,
      `Address: ${address || '—'}`,
      `Estimate shown: ${estText} + HST`,
      `Crew size: ${crewSize || '—'} movers`,
      ``,
      `Inventory: ${inventorySummary || '—'}`,
      ``,
      `Source: QR code / direct mail`,
    ].join('\n')

    if (!isHealthCheck) {
      void sendInternalAlertSms(JOHN_NUMBER, smsText, BUSINESS_NUMBER)
      void sendRepAlertEmail(
        emailSubject,
        `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a"><pre style="white-space:pre-wrap;font:14px/1.6 Arial,sans-serif;margin:0">${escapeHtml(emailBody)}</pre></div>`
      )
    }

    return NextResponse.json({ success: true, leadId, healthCheck: isHealthCheck }, { headers: corsHeaders })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save your info' },
      { status: 500, headers: corsHeaders }
    )
  }
}
