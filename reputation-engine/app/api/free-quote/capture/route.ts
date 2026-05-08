import { NextResponse } from 'next/server'
import { requireSupabaseEnv, requireWorkerBaseUrl } from '@/lib/server/runtime'

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

export async function POST(request: Request) {
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
    }

    const { name = '', phone = '', email = '', address = '', estimateMin, estimateMax, inventorySummary, crewSize } = body

    if (!name.trim() && !phone.trim() && !email.trim()) {
      return NextResponse.json(
        { error: 'Please provide your name or contact info' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { url, headers } = requireSupabaseEnv()
    const leadId = `fq_${crypto.randomUUID().slice(0, 8)}`

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
        source: 'free_quote_qr',
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
        claimed: false,
        created_at: new Date().toISOString(),
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

    // SMS to John's personal cell
    try {
      const workerUrl = requireWorkerBaseUrl()
      await fetch(`${workerUrl}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: JOHN_NUMBER, body: smsText, leadId }),
      })
    } catch { /* non-critical */ }

    // Email to business@starmovers.ca
    try {
      const workerUrl = requireWorkerBaseUrl()
      await fetch(`${workerUrl}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'business@starmovers.ca',
          subject: emailSubject,
          body: emailBody,
          leadId,
        }),
      })
    } catch { /* non-critical */ }

    return NextResponse.json({ success: true, leadId }, { headers: corsHeaders })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save your info' },
      { status: 500, headers: corsHeaders }
    )
  }
}
