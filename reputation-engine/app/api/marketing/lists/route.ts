import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  const [listsRes, countRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_lists?select=*&order=created_at.desc`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_list_contacts?select=list_id`, { headers, cache: 'no-store' }),
  ])

  if (!listsRes.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  const lists = await listsRes.json() as Record<string, unknown>[]
  const memberships = (countRes.ok ? await countRes.json() : []) as { list_id: string }[]

  const countMap = new Map<string, number>()
  for (const m of memberships) {
    countMap.set(m.list_id, (countMap.get(m.list_id) ?? 0) + 1)
  }

  return NextResponse.json(lists.map(l => ({ ...l, contact_count: countMap.get(l.id as string) ?? 0 })))
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { name: string; description?: string; tier?: number; color?: string }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()

  const res = await fetch(`${url}/rest/v1/market_lists`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      tier: body.tier ?? null,
      color: body.color ?? 'slate',
      created_by: session.name ?? 'Rep',
    }),
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to create list' }, { status: 500 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, list: created })
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/market_lists?id=eq.${id}`, { method: 'DELETE', headers })
  return NextResponse.json({ ok: true })
}
