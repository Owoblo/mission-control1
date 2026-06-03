import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { url, headers } = requireSupabaseEnv()

  const membersRes = await fetch(
    `${url}/rest/v1/market_list_contacts?list_id=eq.${id}&select=contact_id,added_at,added_by&order=added_at.desc`,
    { headers, cache: 'no-store' }
  )
  if (!membersRes.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })

  const members = await membersRes.json() as { contact_id: string; added_at: string; added_by: string }[]
  if (members.length === 0) return NextResponse.json([])

  const ids = members.map(m => `"${m.contact_id}"`).join(',')
  const contactsRes = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${ids})&select=id,name,company,email,phone,stage,outreach_tier,city,industry,last_touch_at,sequence_paused,decision`,
    { headers, cache: 'no-store' }
  )
  const contacts = (contactsRes.ok ? await contactsRes.json() : []) as Record<string, unknown>[]

  const contactMap = new Map(contacts.map(c => [c.id as string, c]))
  return NextResponse.json(members.map(m => ({
    ...contactMap.get(m.contact_id),
    _added_at: m.added_at,
    _added_by: m.added_by,
  })).filter(c => c.id))
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { contact_ids: string[] }
  if (!Array.isArray(body.contact_ids) || body.contact_ids.length === 0) {
    return NextResponse.json({ error: 'contact_ids required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const rows = body.contact_ids.map(cid => ({
    list_id: id,
    contact_id: cid,
    added_by: session.name ?? 'Rep',
    added_at: new Date().toISOString(),
  }))

  const res = await fetch(`${url}/rest/v1/market_list_contacts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to add contacts' }, { status: 500 })
  return NextResponse.json({ ok: true, added: rows.length })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { contact_id: string }
  if (!body.contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  await fetch(
    `${url}/rest/v1/market_list_contacts?list_id=eq.${id}&contact_id=eq.${body.contact_id}`,
    { method: 'DELETE', headers }
  )
  return NextResponse.json({ ok: true })
}
