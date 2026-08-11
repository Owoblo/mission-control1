import { NextResponse } from 'next/server'
import { getOfferByToken, listSubcontractorOffers, respondToOffer } from '@/lib/server/subcontractors'
import { handoffAwardToCrew } from '@/lib/server/subcontractor-award'
import { sendSalesMessage } from '@/lib/server/sales-messaging'

function publicPayload(match: NonNullable<Awaited<ReturnType<typeof getOfferByToken>>>) {
  const { offer, recipient } = match
  return {
    offer: {
      id: offer.id, status: offer.status, moveDate: offer.moveDate, arrivalWindow: offer.arrivalWindow,
      originCity: offer.originCity, destinationCity: offer.destinationCity, estimatedHoursMin: offer.estimatedHoursMin,
      estimatedHoursMax: offer.estimatedHoursMax, suggestedTruck: offer.suggestedTruck, crewSize: offer.crewSize,
      requiredServiceTags: offer.requiredServiceTags, accessSummary: offer.accessSummary, scopeNotes: offer.scopeNotes,
      sanitizedBriefing: offer.sanitizedBriefing,
      offeredPayout: offer.offeredPayout, currency: offer.currency, expiresAt: offer.expiresAt,
    },
    recipient: { status: recipient.status, companyName: recipient.subcontractor?.companyName, contactName: recipient.subcontractor?.contactName },
  }
}

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const match = await getOfferByToken(token).catch(() => null)
  if (!match) return NextResponse.json({ error: 'Offer link not found.' }, { status: 404 })
  await respondToOffer(token, 'view').catch(() => null)
  return NextResponse.json(publicPayload(match))
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const body = await request.json().catch(() => ({})) as { action?: 'accept' | 'decline' | 'discussion'; note?: string }
  if (!body.action || !['accept', 'decline', 'discussion'].includes(body.action)) return NextResponse.json({ error: 'Choose accept, decline, or ask a question.' }, { status: 400 })
  const before = await getOfferByToken(token).catch(() => null)
  if (!before) return NextResponse.json({ error: 'Offer link not found.' }, { status: 404 })
  try {
    const result = await respondToOffer(token, body.action, body.note)
    if (result?.outcome === 'accepted') {
      const lead = await handoffAwardToCrew(result.offer_id, result.subcontractor_id)
      const entry = lead.crewPayouts?.find(item => item.subcontractorOfferId === result.offer_id)
      const contractor = before.recipient.subcontractor
      if (entry?.dispatchToken && contractor?.phone) {
        const dispatchUrl = `${new URL(request.url).origin}/crew/dispatch/${entry.dispatchToken}`
        await sendSalesMessage({ channel: 'sms', to: contractor.phone, leadId: lead.id, actor: 'human', actorName: 'Operations', body: `You have been awarded the Saturn Star job. Full dispatch packet: ${dispatchUrl}` }).catch(() => null)
      }
      const awarded = (await listSubcontractorOffers(lead.id)).find(item => item.id === result.offer_id)
      await Promise.all((awarded?.recipients || [])
        .filter(item => item.subcontractorId !== result.subcontractor_id && item.subcontractor?.phone)
        .map(item => sendSalesMessage({ channel: 'sms', to: item.subcontractor!.phone, leadId: lead.id, actor: 'human', actorName: 'Operations', body: `Thanks for responding. The ${awarded?.moveDate || ''} ${awarded?.originCity || ''} to ${awarded?.destinationCity || ''} job has been filled.` }).catch(() => null)))
    }
    const messages: Record<string, string> = {
      accepted: 'The job is yours. Your full dispatch packet is on the way.', already_awarded: 'This job has already been awarded.',
      available: 'Availability received. Operations will choose and contact the winning contractor.', declined: 'Thanks—your decline has been recorded.',
      discussion: 'Your question was sent to Operations.', closed: 'This offer is closed or expired.',
    }
    return NextResponse.json({ outcome: result?.outcome, message: messages[result?.outcome] || 'Response recorded.' })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record response.' }, { status: 500 }) }
}
