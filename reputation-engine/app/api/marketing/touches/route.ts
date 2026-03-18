import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contactId = searchParams.get('contact_id')
  if (!contactId) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(contactId)}&order=created_at.desc`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json(await res.json())
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    contact_id: string
    channel: string
    direction?: string
    notes?: string
    new_stage?: string
  }

  if (!body.contact_id || !body.channel) {
    return NextResponse.json({ error: 'contact_id and channel required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()

  // Insert touch
  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      channel: body.channel,
      direction: body.direction ?? 'outbound',
      notes: body.notes ?? null,
      created_by: session.name ?? 'Rep',
    }),
  })

  // Update contact's last_touch and optionally stage
  const updates: Record<string, unknown> = { last_touch_at: new Date().toISOString() }
  if (body.new_stage) updates.stage = body.new_stage

  await fetch(
    `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(body.contact_id)}`,
    { method: 'PATCH', headers, body: JSON.stringify(updates) }
  )

  return NextResponse.json({ ok: true })
}
