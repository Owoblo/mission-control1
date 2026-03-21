import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/market_signals?select=*&order=created_at.desc`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json(await res.json())
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    id: string
    status: string
    notes?: string
    claim?: boolean
    converted_contact_id?: string | null
  }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/market_signals?id=eq.${body.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      status: body.status,
      notes: body.notes ?? null,
      actioned_at: body.status !== 'new' ? new Date().toISOString() : null,
      claimed_by: body.claim ? (session.name ?? 'Rep') : undefined,
      claimed_at: body.claim ? new Date().toISOString() : undefined,
      converted_contact_id: body.converted_contact_id ?? undefined,
      converted_at: body.converted_contact_id ? new Date().toISOString() : undefined,
    }),
  })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/market_signals`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ ...body, status: 'new' }),
  })
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  const [created] = await res.json()
  return NextResponse.json({ ok: true, signal: created })
}
