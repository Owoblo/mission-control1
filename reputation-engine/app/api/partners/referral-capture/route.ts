import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/server/rate-limit'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { inferSalesBranchFromCity } from '@/lib/sales-phones'
import { getPartnershipAlertRecipients, sendRepAlertEmail } from '@/lib/server/internal-notifications'
import type { SalesBranch } from '@/lib/types'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const MARKET_BRANCH: Record<string, SalesBranch> = {
  windsor: 'windsor',
  chatham: 'windsor',
  chatham_kent: 'windsor',
  london: 'london',
  sarnia: 'london',
  woodstock: 'london',
  waterloo: 'waterloo',
  kitchener: 'waterloo',
  guelph: 'waterloo',
  cambridge: 'waterloo',
  kw: 'waterloo',
  kwg: 'waterloo',
  wkg: 'waterloo',
  ottawa: 'ottawa',
}

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function generateId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function normalizeMarket(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function branchFromInput(input: {
  market: string
  originCity: string
  destCity: string
  address: string
}): SalesBranch {
  return MARKET_BRANCH[input.market] ||
    inferSalesBranchFromCity(input.originCity) ||
    inferSalesBranchFromCity(input.destCity) ||
    inferSalesBranchFromCity(input.address) ||
    'windsor'
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders })
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const limited = rateLimit(`partner-referral:${ip}`, 12, 60_000)
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many referral submissions. Try again shortly.' },
      { status: 429, headers: { ...corsHeaders, 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } }
    )
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const partnerCode = clean(body.partner_code || body.partnerCode).toLowerCase()
  const partnerSlug = clean(body.partner_slug || body.partnerSlug).toLowerCase()
  const partnerName = clean(body.partner_name || body.partnerName || partnerCode || 'Partner')
  const partnerType = clean(body.partner_type || body.partnerType || body.referral_source_type || body.referralSourceType)
  const partnerCompany = clean(body.partner_company || body.partnerCompany)
  const market = normalizeMarket(body.market || body.partner_market || body.partnerMarket)
  const customerName = clean(body.client_name || body.customer_name || body.name)
  const customerPhone = clean(body.client_phone || body.customer_phone || body.phone)
  const customerEmail = clean(body.client_email || body.customer_email || body.email).toLowerCase()
  const movingFrom = clean(body.moving_from || body.origin_address || body.originAddress || body.address)
  const movingTo = clean(body.moving_to || body.dest_address || body.destAddress)
  const moveDate = clean(body.move_date || body.moveDate)
  const moveSize = clean(body.move_size || body.moveSize)
  const notes = clean(body.notes || body.message)
  const sourceUrl = clean(body.source_url || body.sourceUrl)
  const userAgent = request.headers.get('user-agent') || ''

  if (!partnerCode) {
    return NextResponse.json({ error: 'Missing partner code' }, { status: 400, headers: corsHeaders })
  }
  if (!customerName && !customerPhone && !customerEmail) {
    return NextResponse.json({ error: 'Please include a client name, phone, or email.' }, { status: 400, headers: corsHeaders })
  }

  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()
  const inboundId = generateId('inbound')
  const leadId = generateId('lead')
  const branch = branchFromInput({ market, originCity: movingFrom, destCity: movingTo, address: movingFrom })
  const message = [
    `Partner referral code: ${partnerCode}`,
    partnerSlug && partnerSlug !== partnerCode ? `Partner slug: ${partnerSlug}` : '',
    `Partner: ${partnerName}`,
    partnerType ? `Partner type: ${partnerType}` : '',
    partnerCompany ? `Partner company: ${partnerCompany}` : '',
    market ? `Market: ${market}` : '',
    movingFrom ? `Moving from: ${movingFrom}` : '',
    movingTo ? `Moving to: ${movingTo}` : '',
    moveDate ? `Move date: ${moveDate}` : '',
    moveSize ? `Move size: ${moveSize}` : '',
    notes ? `Notes: ${notes}` : '',
  ].filter(Boolean).join(' | ')

  const rawData = {
    channel: 'partner_referral_package',
    referral_partner_code: partnerCode,
    referralPartnerCode: partnerCode,
    referral_partner_slug: partnerSlug || null,
    referralPartnerSlug: partnerSlug || null,
    referral_partner_name: partnerName,
    referralPartnerName: partnerName,
    referral_partner_type: partnerType || null,
    referralPartnerType: partnerType || null,
    referral_partner_company: partnerCompany || null,
    referralPartnerCompany: partnerCompany || null,
    referral_partner_market: market || null,
    referralPartnerMarket: market || null,
    sourceUrl: sourceUrl || null,
    movingFrom: movingFrom || null,
    movingTo: movingTo || null,
    moveDate: moveDate || null,
    moveSize: moveSize || null,
    notes: notes || null,
    userAgent,
  }

  const inboundRes = await fetch(`${url}/rest/v1/inbound_leads`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: inboundId,
      source: 'partner_referral',
      name: customerName || partnerName,
      phone: customerPhone || null,
      email: customerEmail || null,
      message,
      raw_data: rawData,
      claimed: false,
      created_at: now,
    }),
  })

  if (!inboundRes.ok) {
    const error = await inboundRes.text()
    return NextResponse.json({ error: `Could not save referral: ${error}` }, { status: 500, headers: corsHeaders })
  }

  const leadData = {
    id: leadId,
    name: customerName || 'Partner referral lead',
    phone: customerPhone || undefined,
    email: customerEmail || undefined,
    moveDate: moveDate || undefined,
    originAddress: movingFrom || undefined,
    destAddress: movingTo || undefined,
    source: 'referral',
    stage: 'new',
    branch,
    inboundId,
    inboundMessage: message,
    referralPartnerId: partnerCode,
    referralPartnerName: partnerName,
    referralPartnerCode: partnerCode,
    referralPartnerSlug: partnerSlug || undefined,
    referralSourceType: partnerType || undefined,
    referralPartnerCompany: partnerCompany || undefined,
    referralPartnerMarket: market || undefined,
    referralRewardRule: 'Reward credited only after completed paid move.',
    rewardStatus: 'not_eligible_until_completed_paid_move',
    rewardDue: false,
    rewardPaid: false,
    attribution: {
      source: 'partner_referral',
      partnerCode,
      partnerSlug: partnerSlug || undefined,
      partnerName,
      partnerType: partnerType || undefined,
      partnerCompany: partnerCompany || undefined,
      market: market || undefined,
      sourceUrl: sourceUrl || undefined,
    },
    notes: [
      `Referral partner: ${partnerName} (${partnerCode})`,
      partnerType ? `Partner type: ${partnerType}` : '',
      partnerCompany ? `Partner company: ${partnerCompany}` : '',
      partnerSlug && partnerSlug !== partnerCode ? `Partner slug: ${partnerSlug}` : '',
      market ? `Market: ${market}` : '',
      moveSize ? `Move size: ${moveSize}` : '',
      'Reward rule: credit partner only after a completed paid move.',
      notes,
    ].filter(Boolean).join('\n') || undefined,
    createdAt: now,
    updatedAt: now,
    lastInboundAt: now,
  }

  await fetch(`${url}/rest/v1/crm_leads`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ id: leadId, data: leadData }),
  }).catch(() => {})

  void (async () => {
    const partnerMatchRes = await fetch(
      `${url}/rest/v1/market_contacts?select=id,partner_company_id,affiliate_partner_id,tracking_code,linked_partner_id&or=(tracking_code.eq.${encodeURIComponent(partnerCode)},affiliate_partner_id.eq.${encodeURIComponent(partnerCode)},linked_partner_id.eq.${encodeURIComponent(partnerCode)})&limit=1`,
      { headers, cache: 'no-store' }
    ).catch(() => null)
    const [partnerContact] = partnerMatchRes?.ok ? await partnerMatchRes.json() as Array<{
      id: string
      partner_company_id: string | null
      affiliate_partner_id: string | null
      tracking_code: string | null
      linked_partner_id: string | null
    }> : []

    const referralRes = await fetch(`${url}/rest/v1/partner_referrals`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        contact_id: partnerContact?.id || null,
        company_id: partnerContact?.partner_company_id || null,
        affiliate_partner_id: partnerContact?.affiliate_partner_id || partnerContact?.linked_partner_id || null,
        partner_code: partnerCode,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        customer_email: customerEmail || null,
        job_city: market || branch,
        move_date: moveDate || null,
        inbound_lead_id: inboundId,
        crm_lead_id: leadId,
        job_status: 'new',
        commission_status: 'rule_required',
        source: 'partner_referral_package',
        proof_notes: message,
      }),
    }).catch(() => null)

    const [referral] = referralRes?.ok ? await referralRes.json() as Array<{ id: string }> : []
    if (partnerContact?.id) {
      const countRes = await fetch(
        `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(partnerContact.id)}&select=referred_lead_count&limit=1`,
        { headers, cache: 'no-store' }
      ).catch(() => null)
      const [countRow] = countRes?.ok ? await countRes.json() as Array<{ referred_lead_count: number | null }> : []
      await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(partnerContact.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ referred_lead_count: (countRow?.referred_lead_count || 0) + 1 }),
      }).catch(() => {})
    }
    await fetch(`${url}/rest/v1/partner_activity_logs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: partnerContact?.id || null,
        company_id: partnerContact?.partner_company_id || null,
        referral_id: referral?.id || null,
        action: 'referral.created',
        next_value: {
          partnerCode,
          inboundId,
          leadId,
          customerName,
          customerPhone,
          customerEmail,
          market,
          branch,
        },
        metadata: { source: 'partner_referral_capture' },
      }),
    }).catch(() => {})
  })().catch(() => {})

  void sendRepAlertEmail(
    `New partner referral: ${customerName || customerPhone || customerEmail || 'New lead'} from ${partnerName}`,
    `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#071421">
  <div style="background:#071421;color:#C99700;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:800">New Partner Referral</div>
  <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 10px 10px;padding:18px">
    <p><strong>Partner:</strong> ${escapeHtml(partnerName)} (${escapeHtml(partnerCode)})</p>
    ${partnerType ? `<p><strong>Partner type:</strong> ${escapeHtml(partnerType)}</p>` : ''}
    ${partnerCompany ? `<p><strong>Partner company:</strong> ${escapeHtml(partnerCompany)}</p>` : ''}
    ${market ? `<p><strong>Market:</strong> ${escapeHtml(market)} · ${escapeHtml(branch)}</p>` : `<p><strong>Branch:</strong> ${escapeHtml(branch)}</p>`}
    <p><strong>Client:</strong> ${escapeHtml(customerName || '—')}</p>
    <p><strong>Phone:</strong> ${escapeHtml(customerPhone || '—')}</p>
    <p><strong>Email:</strong> ${escapeHtml(customerEmail || '—')}</p>
    ${moveDate ? `<p><strong>Move date:</strong> ${escapeHtml(moveDate)}</p>` : ''}
    ${movingFrom || movingTo ? `<p><strong>Route:</strong> ${escapeHtml(movingFrom || '—')} ${movingTo ? `to ${escapeHtml(movingTo)}` : ''}</p>` : ''}
    ${notes ? `<div style="margin-top:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap">${escapeHtml(notes)}</div>` : ''}
    <p style="margin-top:16px"><a href="https://go.quote2move.com/sales/leads/${encodeURIComponent(leadId)}" style="background:#071421;color:#C99700;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open CRM Lead</a></p>
    <div style="margin-top:14px;font-size:11px;color:#94a3b8">Inbound ID: ${escapeHtml(inboundId)} · Lead ID: ${escapeHtml(leadId)}</div>
  </div>
</div>`,
    getPartnershipAlertRecipients()
  )

  return NextResponse.json({ ok: true, inboundId, leadId, partnerCode, market, branch }, { headers: corsHeaders })
}
