import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  const [batchRes, contactRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=created_at.desc`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_contacts?select=batch_id,stage,sequence_paused,pipeline_phase,decision&batch_id=not.is.null`, { headers, cache: 'no-store' }),
  ])

  if (!batchRes.ok) return NextResponse.json({ error: 'Failed to load batches' }, { status: 500 })

  const batches = await batchRes.json() as Record<string, unknown>[]
  const contacts = (contactRes.ok ? await contactRes.json() : []) as Record<string, unknown>[]

  const byBatch = new Map<string, Record<string, unknown>[]>()
  for (const c of contacts) {
    const bid = c.batch_id as string
    if (!bid) continue
    byBatch.set(bid, [...(byBatch.get(bid) ?? []), c])
  }

  const enriched = batches.map(batch => {
    const bc = byBatch.get(batch.id as string) ?? []
    return {
      ...batch,
      total_contacts: bc.length,
      responded_count: bc.filter(c => c.sequence_paused).length,
      engaged_count: bc.filter(c => ['connected', 'qualified'].includes(c.stage as string ?? '')).length,
      partner_count: bc.filter(c => c.stage === 'partnership_active' || c.decision === 'agreed').length,
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    name: string
    industry?: string
    city?: string
    sequence_type?: string
    email_delay_days?: number
    sms_delay_days?: number
    rep_name?: string
    partnership_phone?: string
    tracking_code?: string
    notes?: string
  }

  const { url, headers } = requireSupabaseEnv()

  const res = await fetch(`${url}/rest/v1/market_campaigns`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: body.name,
      industry: body.industry ?? null,
      city: body.city ?? null,
      status: 'active',
      sequence_type: body.sequence_type ?? 'standard',
      email_delay_days: body.email_delay_days ?? 7,
      sms_delay_days: body.sms_delay_days ?? 5,
      rep_name: body.rep_name ?? 'Eric',
      partnership_phone: body.partnership_phone ?? '+12267746581',
      tracking_code: body.tracking_code ?? null,
      notes: body.notes ?? null,
    }),
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, batch: created })
}
