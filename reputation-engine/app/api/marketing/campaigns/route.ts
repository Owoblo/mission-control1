import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const [campaignRes, contactRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=sent_date.desc`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_contacts?select=batch_id,stage,decision,sequence_paused,pipeline_phase&batch_id=not.is.null`, { headers, cache: 'no-store' }),
  ])

  if (!campaignRes.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  const campaigns = await campaignRes.json() as Array<Record<string, unknown>>
  const contacts = contactRes.ok ? await contactRes.json() as Array<Record<string, unknown>> : []

  const byBatch = new Map<string, Array<Record<string, unknown>>>()
  for (const contact of contacts) {
    const batchId = String(contact.batch_id || '')
    if (!batchId) continue
    byBatch.set(batchId, [...(byBatch.get(batchId) ?? []), contact])
  }

  const enriched = campaigns.map(campaign => {
    const batchContacts = byBatch.get(String(campaign.id)) ?? []
    const liveLetters = batchContacts.length
    const liveResponses = batchContacts.filter(contact => Boolean(contact.sequence_paused)).length
    const liveBookings = batchContacts.filter(contact => String(contact.decision || '') === 'agreed' || String(contact.stage || '') === 'partnership_active').length

    return {
      ...campaign,
      live_letters_sent: liveLetters,
      live_responses: liveResponses,
      live_bookings: liveBookings,
      live_total: batchContacts.length,
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/market_campaigns`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: body.name,
      industry: body.industry,
      tracking_code: body.tracking_code,
      tier: body.tier,
      letters_sent: body.letters_sent ?? 0,
      sent_date: body.sent_date ?? null,
      cost_cents: Math.round((body.cost ?? 0) * 100),
      notes: body.notes ?? null,
    }),
  })
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, campaign: created })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { id: string; responses?: number; bookings?: number; revenue?: number; notes?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.responses !== undefined) updates.responses = body.responses
  if (body.bookings !== undefined) updates.bookings = body.bookings
  if (body.revenue !== undefined) updates.revenue_cents = Math.round(body.revenue * 100)
  if (body.notes !== undefined) updates.notes = body.notes

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/market_campaigns?id=eq.${body.id}`, {
    method: 'PATCH', headers, body: JSON.stringify(updates),
  })
  return NextResponse.json({ ok: true })
}
