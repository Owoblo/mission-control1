import { NextResponse } from 'next/server'
import { requireSupabaseEnv, getAppBaseUrl, readEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

function generateId(prefix = 'aff') {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`
}

async function verifyToken(token: string) {
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/review_partners?data->>affiliateToken=eq.${encodeURIComponent(token)}&deleted=is.null&select=id,data`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return null
  const records = await res.json() as Array<{ id: string; data: Record<string, unknown> }>
  return records[0] ?? null
}

async function notifyTeam(partnerName: string, customerName: string, phone: string | null, email: string | null, originCity: string | null, destCity: string | null) {
  const resendKey = readEnv('RESEND_API_KEY')
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
  if (!resendKey) return

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Saturn Star Movers <business@starmovers.ca>',
      to: ['business@starmovers.ca'],
      subject: `🤝 New referral from ${partnerName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;color:#1a2744">
          <h2>New Referral Lead</h2>
          <p><strong>Partner:</strong> ${partnerName}</p>
          <p><strong>Customer:</strong> ${customerName}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
          ${email ? `<p><strong>Email:</strong> ${email}</p>` : ''}
          ${originCity ? `<p><strong>Route:</strong> ${originCity}${destCity ? ` → ${destCity}` : ''}</p>` : ''}
          <p><a href="${appUrl}/sales" style="background:#0f6a53;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">Open in CRM →</a></p>
        </div>
      `,
    }),
  }).catch(() => {})
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 401 })

  const partner = await verifyToken(token)
  if (!partner) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/affiliate_submissions?partner_id=eq.${partner.id}&order=created_at.desc&limit=50`,
    { headers, cache: 'no-store' }
  )
  const submissions = res.ok ? await res.json() : []
  return NextResponse.json({ submissions })
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 401 })

  const partner = await verifyToken(token)
  if (!partner) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  const body = await request.json() as {
    customer_name: string
    customer_phone?: string
    customer_email?: string
    move_date?: string
    move_size?: string
    origin_city?: string
    dest_city?: string
    notes?: string
  }

  if (!body.customer_name?.trim()) {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const submissionId = generateId('aff')
  const now = new Date().toISOString()
  const partnerName = String((partner.data as Record<string, unknown>).name || 'Partner')

  // 1. Save the affiliate submission
  const subRes = await fetch(`${url}/rest/v1/affiliate_submissions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      id: submissionId,
      partner_id: partner.id,
      customer_name: body.customer_name.trim(),
      customer_phone: body.customer_phone?.trim() || null,
      customer_email: body.customer_email?.trim() || null,
      move_date: body.move_date || null,
      move_size: body.move_size || null,
      origin_city: body.origin_city?.trim() || null,
      dest_city: body.dest_city?.trim() || null,
      notes: body.notes?.trim() || null,
      status: 'pending',
      created_at: now,
      updated_at: now,
    }),
  })

  if (!subRes.ok) return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  const [submission] = await subRes.json()

  // 2. Create a CRM lead tagged with this partner
  const leadId = `lead_${Math.random().toString(36).slice(2, 11)}`
  const leadData = {
    id: leadId,
    name: body.customer_name.trim(),
    phone: body.customer_phone?.trim() || undefined,
    email: body.customer_email?.trim() || undefined,
    moveDate: body.move_date || undefined,
    originCity: body.origin_city?.trim() || undefined,
    destCity: body.dest_city?.trim() || undefined,
    source: 'referral',
    referralPartnerId: partner.id,
    referralPartnerName: partnerName,
    stage: 'new',
    notes: [body.notes, body.move_size ? `Move size: ${body.move_size}` : ''].filter(Boolean).join('\n') || undefined,
    createdAt: now,
    updatedAt: now,
    branch: 'windsor',
  }

  await fetch(`${url}/rest/v1/crm_leads`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ id: leadId, data: leadData }),
  }).catch(() => {})

  // Link submission to CRM lead
  await fetch(`${url}/rest/v1/affiliate_submissions?id=eq.${submissionId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ crm_lead_id: leadId }),
  }).catch(() => {})

  // 3. Notify team
  void notifyTeam(
    partnerName,
    body.customer_name.trim(),
    body.customer_phone || null,
    body.customer_email || null,
    body.origin_city || null,
    body.dest_city || null,
  )

  return NextResponse.json({ ok: true, submission })
}
