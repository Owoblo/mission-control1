import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

interface PartnerRecord {
  id: string
  data: {
    name?: string
    email?: string
    phone?: string
    company?: string
    type?: string
    affiliateToken?: string
    commissionRate?: number
    commissionType?: 'per_job' | 'percentage'
    totalJobsReferred?: number
    totalIncentiveOwed?: number
    createdAt?: string
  }
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')?.trim()
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()

  // Find partner by affiliate token stored in JSONB data
  const res = await fetch(
    `${url}/rest/v1/review_partners?data->>affiliateToken=eq.${encodeURIComponent(token)}&deleted=is.null&select=id,data`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })

  const records = await res.json() as PartnerRecord[]
  if (!records.length) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

  const partner = records[0]
  return NextResponse.json({
    id: partner.id,
    name: partner.data.name || 'Partner',
    email: partner.data.email || null,
    company: partner.data.company || null,
    type: partner.data.type || 'other',
    commissionRate: partner.data.commissionRate ?? 50,
    commissionType: partner.data.commissionType ?? 'per_job',
    totalJobsReferred: partner.data.totalJobsReferred ?? 0,
  })
}
