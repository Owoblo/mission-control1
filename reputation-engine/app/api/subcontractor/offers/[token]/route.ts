import { NextResponse } from 'next/server'
import { acceptOffer, getRecipientByToken, updateRecipient } from '@/lib/server/subcontractor-repository'

function publicPayload(row: NonNullable<Awaited<ReturnType<typeof getRecipientByToken>>>) {
  const offer = row.subcontractor_offers
  return {
    companyName: row.subcontractors.company_name,
    contactName: row.subcontractors.contact_name,
    status: row.status,
    offer: {
      id: offer.id, status: offer.status, moveDate: offer.move_date,
      originCity: offer.origin_city, destinationCity: offer.destination_city,
      distanceKm: offer.distance_km, hoursMin: offer.estimated_hours_min, hoursMax: offer.estimated_hours_max,
      suggestedTruck: offer.suggested_truck, crewSize: offer.crew_size,
      inventory: offer.inventory, access: offer.access_summary, notes: offer.scope_notes,
      payout: offer.offered_payout, currency: offer.currency, expiresAt: offer.expires_at,
    },
  }
}

export async function GET(_: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const row = await getRecipientByToken(token)
  if (!row) return NextResponse.json({ error: 'Offer link not found' }, { status: 404 })
  if (!row.viewed_at) await updateRecipient(row.id, { status: row.status === 'sent' ? 'viewed' : row.status, viewed_at: new Date().toISOString() })
  return NextResponse.json(publicPayload(row))
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const row = await getRecipientByToken(token)
  if (!row) return NextResponse.json({ error: 'Offer link not found' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { action?: string; note?: string }
  if (body.action === 'accept') {
    const result = await acceptOffer(token)
    if (result?.outcome === 'accepted') return NextResponse.json({ ok: true, outcome: 'accepted' })
    if (result?.outcome === 'already_awarded') return NextResponse.json({ error: 'This job has already been awarded.', outcome: result.outcome }, { status: 409 })
    return NextResponse.json({ error: 'This offer is no longer open.', outcome: result?.outcome }, { status: 409 })
  }
  if (body.action === 'decline' || body.action === 'discussion') {
    const status = body.action === 'decline' ? 'declined' : 'discussion'
    await updateRecipient(row.id, { status, responded_at: new Date().toISOString(), response_note: String(body.note || '').trim() || null })
    return NextResponse.json({ ok: true, outcome: status })
  }
  return NextResponse.json({ error: 'Choose accept, decline, or discuss.' }, { status: 400 })
}
