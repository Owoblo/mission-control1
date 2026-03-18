import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/market_campaigns?select=*&order=sent_date.desc`, { headers, cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json(await res.json())
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
