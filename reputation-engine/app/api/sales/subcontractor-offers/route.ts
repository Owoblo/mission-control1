import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { createSubcontractorOffer, listSubcontractorOffers, listSubcontractors, updateOfferRecipient, updateSubcontractorOfferStatus } from '@/lib/server/subcontractors'
import { buildSubcontractorOfferSms, evaluateSubcontractorEligibility, type SubcontractorOffer } from '@/lib/subcontractors'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { buildAwardedCrewBrief, buildSanitizedPartnerBrief, derivePartnerJobReadiness } from '@/lib/subcontractor-briefing'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leadId = new URL(request.url).searchParams.get('leadId') || undefined
  if (leadId) {
    const lead = await getSalesLead(leadId)
    if (!lead || !leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try { return NextResponse.json({ offers: await listSubcontractorOffers(leadId) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load offers' }, { status: 500 }) }
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { offerId?: string; action?: 'cancel' | 'resend' }
  const offer = body.offerId ? (await listSubcontractorOffers()).find(item => item.id === body.offerId) : null
  const lead = offer ? await getSalesLead(offer.leadId) : null
  if (!offer || !lead || !leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  if (body.action === 'cancel') {
    await updateSubcontractorOfferStatus(offer.id, 'cancelled')
    await Promise.all((offer.recipients || []).filter(item => item.subcontractor?.phone).map(item =>
      sendSalesMessage({ channel: 'sms', to: item.subcontractor!.phone, leadId: lead.id, actor: 'human', actorName: session?.name || 'Operations', actorUserId: session?.userId, body: `Saturn Star update: the ${offer.moveDate || ''} ${offer.originCity} to ${offer.destinationCity} contractor offer has been cancelled.` }).catch(() => null)
    ))
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'resend') {
    const origin = new URL(request.url).origin
    const recipients = (offer.recipients || []).filter(item => ['send_failed', 'sent', 'viewed'].includes(item.status))
    const results = await Promise.all(recipients.map(async recipient => {
      const contractor = recipient.subcontractor
      if (!contractor || !recipient.token) return false
      try {
        const sent = await sendSalesMessage({ channel: 'sms', to: contractor.phone, leadId: lead.id, actor: 'human', actorName: session?.name || 'Operations', actorUserId: session?.userId, body: buildSubcontractorOfferSms({ companyName: contractor.companyName, moveDate: offer.moveDate, arrivalWindow: offer.arrivalWindow, originCity: offer.originCity, destinationCity: offer.destinationCity, estimatedHoursMin: offer.estimatedHoursMin, estimatedHoursMax: offer.estimatedHoursMax, crewSize: offer.crewSize, payout: offer.offeredPayout, currency: offer.currency, url: `${origin}/contractor/offers/${recipient.token}` }) })
        if (sent.result.blocked) throw new Error(String(sent.result.reason || 'SMS blocked'))
        await updateOfferRecipient(recipient.id, { status: 'sent', sentAt: new Date().toISOString() })
        return true
      } catch (error) {
        await updateOfferRecipient(recipient.id, { status: 'send_failed', smsError: error instanceof Error ? error.message : 'Send failed' })
        return false
      }
    }))
    return NextResponse.json({ ok: true, sent: results.filter(Boolean).length })
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Partial<SubcontractorOffer> & { recipientIds?: string[]; readinessOverrideReason?: string }
  const lead = body.leadId ? await getSalesLead(body.leadId) : null
  if (!lead || !leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (!body.offeredPayout || body.offeredPayout <= 0 || !body.originCity || !body.destinationCity || !body.recipientIds?.length) return NextResponse.json({ error: 'Payout, route, and at least one contractor are required.' }, { status: 400 })
  try {
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId) : null
    const readiness = derivePartnerJobReadiness(lead, quote)
    if (!readiness.ready && !body.readinessOverrideReason?.trim()) return NextResponse.json({ error: 'Job is not ready for contractor offers.', missing: readiness.missing, warnings: readiness.warnings }, { status: 409 })
    const contractors = await listSubcontractors()
    const selected = contractors.filter(item => body.recipientIds!.includes(item.id))
    if (selected.length !== body.recipientIds.length) return NextResponse.json({ error: 'One or more contractors were not found.' }, { status: 400 })
    const ineligible = selected.map(item => ({ item, result: evaluateSubcontractorEligibility(item, { branch: body.branch, originCity: body.originCity, crewSize: body.crewSize, truckSize: body.suggestedTruck, serviceTags: body.requiredServiceTags, moveDate: body.moveDate }) })).filter(item => !item.result.eligible)
    if (ineligible.length) return NextResponse.json({ error: 'Ineligible contractors must be corrected before sending.', ineligible: ineligible.map(({ item, result }) => ({ id: item.id, companyName: item.companyName, reasons: result.reasons })) }, { status: 409 })
    const created = await createSubcontractorOffer({
      leadId: lead.id, quoteId: body.quoteId, branch: body.branch || lead.branch, moveDate: body.moveDate,
      arrivalWindow: body.arrivalWindow, originCity: body.originCity, destinationCity: body.destinationCity,
      distanceKm: body.distanceKm, estimatedHoursMin: body.estimatedHoursMin, estimatedHoursMax: body.estimatedHoursMax,
      suggestedTruck: body.suggestedTruck, crewSize: body.crewSize, requiredServiceTags: body.requiredServiceTags || [],
      inventory: body.inventory || [], accessSummary: body.accessSummary || {}, scopeNotes: body.scopeNotes,
      sanitizedBriefing: buildSanitizedPartnerBrief(lead, quote), awardedCrewBriefing: buildAwardedCrewBrief(lead, quote),
      readinessSnapshot: { ...readiness, overrideReason: body.readinessOverrideReason?.trim() || null }, autoPrepared: readiness.ready,
      offeredPayout: body.offeredPayout, currency: body.currency || 'CAD', awardPolicy: body.awardPolicy || 'first_acceptance',
      expiresAt: body.expiresAt, awardedSubcontractorId: undefined, awardedAt: undefined,
      createdByUserId: session?.userId, createdByName: session?.name,
    }, body.recipientIds)
    const origin = new URL(request.url).origin
    const results = await Promise.all((created.recipients || []).map(async recipient => {
      const contractor = selected.find(item => item.id === recipient.subcontractorId)!
      try {
        const url = `${origin}/contractor/offers/${recipient.token}`
        const offerText = buildSubcontractorOfferSms({ companyName: contractor.companyName, moveDate: created.moveDate, arrivalWindow: created.arrivalWindow, originCity: created.originCity, destinationCity: created.destinationCity, estimatedHoursMin: created.estimatedHoursMin, estimatedHoursMax: created.estimatedHoursMax, crewSize: created.crewSize, payout: created.offeredPayout, currency: created.currency, url })
        const deliveries = await Promise.allSettled([
          sendSalesMessage({ channel: 'sms', to: contractor.phone, leadId: lead.id, actor: 'human', actorName: session?.name || 'Operations', actorUserId: session?.userId, body: offerText }).then(sent => { if (sent.result.blocked) throw new Error(String(sent.result.reason || 'SMS blocked')); return 'sms' }),
          ...(contractor.email ? [sendSalesMessage({ channel: 'email' as const, to: contractor.email, subject: `Saturn Star job offer · ${created.moveDate || 'date TBD'}`, leadId: lead.id, actor: 'human' as const, actorName: session?.name || 'Operations', actorUserId: session?.userId, body: offerText }).then(() => 'email')] : []),
        ])
        const sentChannels = deliveries.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
        if (sentChannels.length === 0) throw new Error(deliveries.map(result => result.status === 'rejected' ? String(result.reason) : '').filter(Boolean).join('; ') || 'Delivery failed')
        await updateOfferRecipient(recipient.id, { status: 'sent', sentAt: new Date().toISOString() })
        return { id: recipient.id, ok: true, channels: sentChannels }
      } catch (error) {
        await updateOfferRecipient(recipient.id, { status: 'send_failed', smsError: error instanceof Error ? error.message : 'Send failed' })
        return { id: recipient.id, ok: false }
      }
    }))
    return NextResponse.json({ offer: created, deliveries: results }, { status: 201 })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create offer' }, { status: 500 }) }
}
