import { NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/server/rate-limit'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { inferSalesBranchFromCity } from '@/lib/sales-phones'
import type { SalesBranch } from '@/lib/types'

export const dynamic = 'force-dynamic'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const MARKET_BRANCH: Record<string, SalesBranch> = {
  windsor: 'windsor',
  london: 'london',
  waterloo: 'waterloo',
  kitchener: 'waterloo',
  guelph: 'waterloo',
  kw: 'waterloo',
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
  const partnerName = clean(body.partner_name || body.partnerName || partnerCode || 'Partner')
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
    `Partner: ${partnerName}`,
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
    referral_partner_name: partnerName,
    referralPartnerName: partnerName,
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
    referralPartnerMarket: market || undefined,
    attribution: {
      source: 'partner_referral',
      partnerCode,
      partnerName,
      market: market || undefined,
      sourceUrl: sourceUrl || undefined,
    },
    notes: [
      `Referral partner: ${partnerName} (${partnerCode})`,
      market ? `Market: ${market}` : '',
      moveSize ? `Move size: ${moveSize}` : '',
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

  return NextResponse.json({ ok: true, inboundId, leadId, partnerCode, market, branch }, { headers: corsHeaders })
}
