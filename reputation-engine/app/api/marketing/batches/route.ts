import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { DEFAULT_PARTNERSHIP_FROM_NUMBER, getPartnershipPrimaryNumberForMarket } from '@/lib/partnership-lines'

export const dynamic = 'force-dynamic'

function dateKeyInZone(value: string | null | undefined, timeZone = 'America/Toronto') {
  if (!value) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const mapped = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${mapped.year}-${mapped.month}-${mapped.day}`
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  const [batchRes, contactRes, jobsRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=created_at.desc`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_contacts?select=batch_id,stage,sequence_paused,pipeline_phase,decision&batch_id=not.is.null`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/sequence_jobs?select=batch_id,channel,status,scheduled_at,sent_at&batch_id=not.is.null&channel=eq.sms`, { headers, cache: 'no-store' }),
  ])

  if (!batchRes.ok) return NextResponse.json({ error: 'Failed to load batches' }, { status: 500 })

  const batches = await batchRes.json() as Record<string, unknown>[]
  const contacts = (contactRes.ok ? await contactRes.json() : []) as Record<string, unknown>[]
  const jobs = (jobsRes.ok ? await jobsRes.json() : []) as Array<{
    batch_id: string | null
    channel: string | null
    status: string | null
    scheduled_at: string | null
    sent_at: string | null
  }>
  const today = dateKeyInZone(new Date().toISOString())

  const byBatch = new Map<string, Record<string, unknown>[]>()
  for (const c of contacts) {
    const bid = c.batch_id as string
    if (!bid) continue
    byBatch.set(bid, [...(byBatch.get(bid) ?? []), c])
  }

  const jobsByBatch = new Map<string, typeof jobs>()
  for (const job of jobs) {
    if (!job.batch_id) continue
    jobsByBatch.set(job.batch_id, [...(jobsByBatch.get(job.batch_id) ?? []), job])
  }

  const enriched = batches.map(batch => {
    const bc = byBatch.get(batch.id as string) ?? []
    const bj = jobsByBatch.get(batch.id as string) ?? []
    const sentJobs = bj.filter(job => job.status === 'sent')
    const pendingJobs = bj.filter(job => job.status === 'pending')
    return {
      ...batch,
      total_contacts: bc.length,
      responded_count: bc.filter(c => c.sequence_paused).length,
      engaged_count: bc.filter(c => ['connected', 'qualified'].includes(c.stage as string ?? '')).length,
      partner_count: bc.filter(c => c.stage === 'partnership_active' || c.decision === 'agreed').length,
      sms_jobs_total: bj.length,
      sms_sent_total: sentJobs.length,
      sms_pending_total: pendingJobs.length,
      sms_sent_today: sentJobs.filter(job => dateKeyInZone(job.sent_at) === today).length,
      sms_pending_today: pendingJobs.filter(job => dateKeyInZone(job.scheduled_at) === today).length,
      sms_failed_total: bj.filter(job => job.status === 'failed').length,
      sms_cancelled_total: bj.filter(job => job.status === 'cancelled').length,
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
      rep_name: body.rep_name ?? 'Partnerships',
      partnership_phone: body.partnership_phone ??
        getPartnershipPrimaryNumberForMarket(body.city || body.name) ??
        DEFAULT_PARTNERSHIP_FROM_NUMBER,
      tracking_code: body.tracking_code ?? null,
      notes: body.notes ?? null,
    }),
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, batch: created })
}
