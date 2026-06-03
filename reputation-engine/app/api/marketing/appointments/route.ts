import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const contactId = searchParams.get('contact_id')

  const { url, headers } = requireSupabaseEnv()
  let query = `${url}/rest/v1/market_appointments?select=*&order=scheduled_at.asc`
  if (contactId) query += `&contact_id=eq.${encodeURIComponent(contactId)}`

  const res = await fetch(query, { headers, cache: 'no-store' })
  if (!res.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 })
  return NextResponse.json(await res.json())
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    contact_id: string
    title: string
    scheduled_at: string
    duration_minutes?: number
    channel?: string
    notes?: string
  }

  if (!body.contact_id || !body.title || !body.scheduled_at) {
    return NextResponse.json({ error: 'contact_id, title and scheduled_at required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()

  const [apptRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_appointments`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        contact_id: body.contact_id,
        title: body.title.trim(),
        scheduled_at: body.scheduled_at,
        duration_minutes: body.duration_minutes ?? 30,
        channel: body.channel ?? 'phone',
        notes: body.notes?.trim() ?? null,
        status: 'scheduled',
        created_by: session.name ?? 'Rep',
      }),
    }),
  ])

  if (!apptRes.ok) return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  const [appt] = await apptRes.json()

  // Log as a touch
  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: body.contact_id,
      channel: body.channel ?? 'phone',
      direction: 'outbound',
      notes: `Appointment booked: ${body.title} — ${new Date(body.scheduled_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      outcome_code: 'meeting_booked',
      created_by: session.name ?? 'Rep',
      created_at: new Date().toISOString(),
      metadata: { appointment_id: appt?.id },
    }),
  })

  await fetch(`${url}/rest/v1/market_contacts?id=eq.${body.contact_id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ meeting_booked_at: body.scheduled_at, stage: 'qualified', last_touch_at: new Date().toISOString() }),
  })

  return NextResponse.json({ ok: true, appointment: appt })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { id: string; status?: string; notes?: string; scheduled_at?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  const updates: Record<string, unknown> = {}
  if (body.status) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.scheduled_at) updates.scheduled_at = body.scheduled_at

  await fetch(`${url}/rest/v1/market_appointments?id=eq.${body.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates),
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/market_appointments?id=eq.${id}`, { method: 'DELETE', headers })
  return NextResponse.json({ ok: true })
}
