import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { listBookedSalesLeads, listOperationalSalesQuotes, getSalesLead, getSalesQuote, saveFollowUpLog } from '@/lib/server/sales-repository'
import {
  createOffer, createRecipients, createSubcontractor, listOfferRecipients,
  listSubcontractorOffers, listSubcontractors, updateOffer, updateRecipient,
} from '@/lib/server/subcontractor-repository'
import { buildSanitizedSubcontractorScope } from '@/lib/subcontractors'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'

function requireOwner(session: Awaited<ReturnType<typeof getSessionUser>>) {
  return session?.role === 'owner'
}

export async function GET() {
  const session = await getSessionUser()
  if (!requireOwner(session)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  const [subcontractors, offers, recipients, leads, quotes] = await Promise.all([
    listSubcontractors(), listSubcontractorOffers(), listOfferRecipients(),
    listBookedSalesLeads(), listOperationalSalesQuotes(),
  ])
  const jobs = leads.map(lead => ({
    leadId: lead.id,
    quoteId: lead.quoteId || quotes.find(q => q.leadId === lead.id)?.id || null,
    name: lead.name,
    moveDate: lead.moveDate,
    branch: lead.branch,
    route: `${lead.originCity || 'Origin'} → ${lead.destCity || 'Destination'}`,
  }))
  return NextResponse.json({ subcontractors, offers, recipients, jobs })
}

async function handlePost(request: Request) {
  const session = await getSessionUser()
  if (!requireOwner(session)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')

  if (action === 'create_subcontractor') {
    const company = String(body.companyName || '').trim()
    const contact = String(body.contactName || '').trim()
    const phone = String(body.phone || '').replace(/[^\d+]/g, '')
    if (!company || !contact || phone.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ error: 'Company, contact, and a valid phone are required.' }, { status: 400 })
    }
    const row = await createSubcontractor({
      company_name: company, contact_name: contact, phone,
      email: String(body.email || '').trim() || null,
      branches: Array.isArray(body.branches) ? body.branches.map(String) : [],
      service_cities: String(body.serviceCities || '').split(',').map(v => v.trim()).filter(Boolean),
      truck_sizes: String(body.truckSizes || '').split(',').map(v => v.trim()).filter(Boolean),
      max_crew_size: Number(body.maxCrewSize || 0) || null,
      insured: body.insured === true,
      notes: String(body.notes || '').trim() || null,
      status: 'active',
    })
    return NextResponse.json({ ok: true, subcontractor: row })
  }

  if (action === 'create_offer') {
    const leadId = String(body.leadId || '')
    const quoteId = String(body.quoteId || '')
    const payout = Math.round(Number(body.payout || 0) * 100) / 100
    const subcontractorIds = Array.isArray(body.subcontractorIds) ? body.subcontractorIds.map(String) : []
    if (!leadId || payout <= 0 || subcontractorIds.length === 0) {
      return NextResponse.json({ error: 'Choose a job, payout, and at least one subcontractor.' }, { status: 400 })
    }
    const [lead, quote] = await Promise.all([getSalesLead(leadId), quoteId ? getSalesQuote(quoteId) : Promise.resolve(null)])
    if (!lead) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const safe = buildSanitizedSubcontractorScope(lead, quote)
    const expiresAt = String(body.expiresAt || '').trim()
    const offer = await createOffer({
      ...safe,
      offered_payout: payout,
      scope_notes: String(body.scopeNotes || '').trim() || null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      status: 'open',
      created_by_user_id: session?.userId,
      created_by_name: session?.name,
    } as never)
    const recipients = await createRecipients(offer.id, subcontractorIds)
    const roster = await listSubcontractors()
    const byId = new Map(roster.map(item => [item.id, item]))
    const base = getAppBaseUrl('https://go.quote2move.com')
    await Promise.all(recipients.map(async recipient => {
      const contractor = byId.get(recipient.subcontractor_id)
      if (!contractor) return
      const link = `${base}/subcontractor/offers/${recipient.token}`
      const message = `New ${safe.move_date || 'upcoming'} moving job: ${safe.origin_city} to ${safe.destination_city}. Offer: $${payout.toFixed(2)} CAD. Review and respond: ${link}`
      try {
        await sendSalesMessage({ channel: 'sms', to: contractor.phone, body: message, actor: 'human', actorName: session?.name || 'Dispatch', actorUserId: session?.userId, notes: `Subcontractor offer ${offer.id}` })
        await updateRecipient(recipient.id, { status: 'sent', sent_at: new Date().toISOString() })
      } catch (error) {
        await updateRecipient(recipient.id, { status: 'send_failed', sms_error: error instanceof Error ? error.message : 'SMS failed' })
      }
    }))
    await saveFollowUpLog({
      id: uid('fu'), leadId, quoteId: quote?.id, type: 'note', date: new Date().toISOString(), createdAt: new Date().toISOString(),
      notes: `Subcontractor offer opened at $${payout.toFixed(2)} and sent to ${recipients.length} approved contractor${recipients.length === 1 ? '' : 's'}.`,
    })
    return NextResponse.json({ ok: true, offer })
  }

  if (action === 'cancel_offer') {
    const offer = await updateOffer(String(body.offerId || ''), { status: 'cancelled' })
    return NextResponse.json({ ok: true, offer })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    return await handlePost(request)
  } catch (error) {
    console.error('Subcontractor action failed', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Subcontractor action failed.',
    }, { status: 500 })
  }
}
