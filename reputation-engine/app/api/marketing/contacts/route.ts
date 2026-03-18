import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stage = searchParams.get('stage')
  const tier = searchParams.get('tier')
  const industry = searchParams.get('industry')
  const q = searchParams.get('q')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const offset = parseInt(searchParams.get('offset') ?? '0')

  const { url, headers } = requireSupabaseEnv()

  let query = `${url}/rest/v1/market_contacts?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`
  if (stage) query += `&stage=eq.${encodeURIComponent(stage)}`
  if (tier) query += `&tier=eq.${encodeURIComponent(tier)}`
  if (industry) query += `&industry=eq.${encodeURIComponent(industry)}`
  if (q) query += `&or=(name.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*,city.ilike.*${encodeURIComponent(q)}*)`

  const res = await fetch(query, { headers: { ...headers, Prefer: 'count=exact' }, cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })

  const contacts = await res.json()
  const total = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0')

  return NextResponse.json({ contacts, total })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { id: string; stage?: string; notes?: string; next_follow_up?: string; email?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.stage) updates.stage = body.stage
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.next_follow_up !== undefined) updates.next_follow_up = body.next_follow_up || null
  if (body.email !== undefined) updates.email = body.email
  if (body.stage) updates.last_touch_at = new Date().toISOString()

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.id)}`,
    { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(updates) }
  )

  if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  const [updated] = await res.json()
  return NextResponse.json({ ok: true, contact: updated })
}
