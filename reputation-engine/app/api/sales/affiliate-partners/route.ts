/**
 * Internal CRM API for managing affiliate partners.
 * GET  — list all partners with their stats
 * POST — create/update a partner and generate their portal token
 */
import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { requireSupabaseEnv, getAppBaseUrl } from '@/lib/server/runtime'
import { randomToken } from '@/lib/server/security'

export const dynamic = 'force-dynamic'

function generateToken() {
  return randomToken('aff')
}

interface PartnerRecord {
  id: string
  data: Record<string, unknown>
}

interface Submission {
  partner_id: string
  status: string
  commission_amount: number
  commission_paid: boolean
}

export async function GET() {
  const session = await hasInternalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')

  const [partnersRes, submissionsRes] = await Promise.all([
    fetch(`${url}/rest/v1/review_partners?deleted=is.null&select=id,data&order=updated_at.desc`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/affiliate_submissions?select=partner_id,status,commission_amount,commission_paid`, { headers, cache: 'no-store' }),
  ])

  const partners = (partnersRes.ok ? await partnersRes.json() : []) as PartnerRecord[]
  const submissions = (submissionsRes.ok ? await submissionsRes.json() : []) as Submission[]

  const subMap = new Map<string, Submission[]>()
  for (const s of submissions) {
    const list = subMap.get(s.partner_id) ?? []
    list.push(s)
    subMap.set(s.partner_id, list)
  }

  const enriched = partners.map(p => {
    const subs = subMap.get(p.id) ?? []
    const won = subs.filter(s => s.status === 'won').length
    const pending = subs.filter(s => ['pending', 'contacted', 'quoted'].includes(s.status)).length
    const commissionEarned = subs.filter(s => s.status === 'won').reduce((sum, s) => sum + (s.commission_amount || 0), 0)
    const commissionPaid = subs.filter(s => s.status === 'won' && s.commission_paid).reduce((sum, s) => sum + (s.commission_amount || 0), 0)
    const token = p.data.affiliateToken as string | undefined
    return {
      id: p.id,
      name: p.data.name,
      email: p.data.email,
      company: p.data.company,
      phone: p.data.phone,
      type: p.data.type,
      commissionRate: p.data.commissionRate ?? 50,
      commissionType: p.data.commissionType ?? 'per_job',
      hasPortal: !!token,
      portalUrl: token ? `${appUrl}/affiliate?token=${token}` : null,
      totalSubmissions: subs.length,
      wonJobs: won,
      pendingLeads: pending,
      commissionEarned,
      commissionOwed: commissionEarned - commissionPaid,
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  const session = await hasInternalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    partner_id?: string
    name?: string
    email?: string
    company?: string
    phone?: string
    type?: string
    commission_rate?: number
    commission_type?: string
    generate_token?: boolean
  }

  const { url, headers } = requireSupabaseEnv()
  const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')

  // If creating a new partner
  if (!body.partner_id) {
    if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const id = `partner_${Math.floor(Math.random() * 900000 + 100000)}`
    const token = generateToken()
    const data = {
      id,
      name: body.name.trim(),
      email: body.email?.trim() || null,
      company: body.company?.trim() || null,
      phone: body.phone?.trim() || null,
      type: body.type || 'realtor',
      commissionRate: body.commission_rate ?? 50,
      commissionType: body.commission_type ?? 'per_job',
      affiliateToken: token,
      totalJobsReferred: 0,
      totalIncentiveOwed: 0,
      createdAt: new Date().toISOString(),
    }
    await fetch(`${url}/rest/v1/review_partners`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ id, data }),
    })
    return NextResponse.json({
      ok: true,
      id,
      portalUrl: `${appUrl}/affiliate?token=${token}`,
      token,
    })
  }

  // Update existing partner
  const partnerRes = await fetch(
    `${url}/rest/v1/review_partners?id=eq.${body.partner_id}&select=id,data`,
    { headers, cache: 'no-store' }
  )
  const [partner] = (partnerRes.ok ? await partnerRes.json() : []) as PartnerRecord[]
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  const token = body.generate_token ? generateToken() : partner.data.affiliateToken as string
  const updated = {
    ...partner.data,
    ...(body.name && { name: body.name.trim() }),
    ...(body.email !== undefined && { email: body.email?.trim() || null }),
    ...(body.company !== undefined && { company: body.company?.trim() || null }),
    ...(body.phone !== undefined && { phone: body.phone?.trim() || null }),
    ...(body.type && { type: body.type }),
    ...(body.commission_rate !== undefined && { commissionRate: body.commission_rate }),
    ...(body.commission_type && { commissionType: body.commission_type }),
    affiliateToken: token,
  }

  await fetch(`${url}/rest/v1/review_partners?id=eq.${body.partner_id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ data: updated }),
  })

  return NextResponse.json({
    ok: true,
    portalUrl: token ? `${appUrl}/affiliate?token=${token}` : null,
    token,
  })
}
