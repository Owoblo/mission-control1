import { NextResponse } from 'next/server'
import { dateStamp, normalizeQuote, syncLeadFromQuoteStatus } from '@/lib/sales'
import { canAccessSalesWorkspace, canEditQuote, validateQuotePricingPermissions } from '@/lib/server/sales-permissions'
import { scheduleQuoteFollowup } from '@/lib/server/sales-automation'
import { getSessionUser } from '@/lib/server/session'
import { getSalesClient, getSalesLead, getSalesQuote, listFollowUpLogs, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const quote = await getSalesQuote(params.id)
    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const [lead, client, followUps] = await Promise.all([
      quote.leadId ? getSalesLead(quote.leadId) : Promise.resolve(null),
      getSalesClient(quote.clientId),
      listFollowUpLogs(),
    ])

    return NextResponse.json({
      quote,
      lead,
      client: client
        ? {
            ...client,
            name: lead?.name || client.name,
            email: lead?.email || client.email,
            phone: lead?.phone || client.phone,
          }
        : lead
          ? {
              id: `lead-${lead.id}`,
              name: lead.name,
              email: lead.email,
              phone: lead.phone,
              createdAt: lead.createdAt,
            }
          : null,
      followUps: followUps.filter(log => log.quoteId === quote.id),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load quote' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const current = await getSalesQuote(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const updates = (await request.json()) as Partial<typeof current>
    const currentLead = current.leadId ? await getSalesLead(current.leadId) : null
    if (!canEditQuote(session, currentLead)) {
      return NextResponse.json({ error: 'You can only edit quotes tied to leads you own.' }, { status: 403 })
    }

    const pricingError = validateQuotePricingPermissions(session, current, updates)
    if (pricingError) {
      return NextResponse.json({ error: pricingError }, { status: 403 })
    }

    const nextStatus = updates.status || current.status
    const today = dateStamp()
    const respondedAt =
      ['accepted', 'declined'].includes(nextStatus) ? updates.respondedAt || current.respondedAt || new Date().toISOString() : current.respondedAt
    const savedQuote = await saveSalesQuote(
      normalizeQuote({
        ...current,
        ...updates,
        id: current.id,
        sentAt: nextStatus === 'sent' ? updates.sentAt || current.sentAt || today : current.sentAt,
        viewedAt: nextStatus === 'viewed' ? updates.viewedAt || current.viewedAt || today : current.viewedAt,
        acceptedAt: nextStatus === 'accepted' ? updates.acceptedAt || current.acceptedAt || today : current.acceptedAt,
        respondedAt,
      })
    )

    let lead = null
    if (savedQuote.leadId) {
      if (currentLead) {
        const nextLead = syncLeadFromQuoteStatus(
          {
            ...currentLead,
            moveDate: Object.prototype.hasOwnProperty.call(updates, 'moveDate') ? updates.moveDate || undefined : currentLead.moveDate,
            originAddress: Object.prototype.hasOwnProperty.call(updates, 'originAddress') ? updates.originAddress || undefined : currentLead.originAddress,
            originCity: Object.prototype.hasOwnProperty.call(updates, 'originCity') ? updates.originCity || undefined : currentLead.originCity,
            destCity: Object.prototype.hasOwnProperty.call(updates, 'destCity') ? updates.destCity || undefined : currentLead.destCity,
          },
          savedQuote
        )
        lead = await saveSalesLead(nextLead)
      }
    }

    if (savedQuote.leadId && savedQuote.status === 'sent' && current.status !== 'sent') {
      void scheduleQuoteFollowup(savedQuote.leadId, savedQuote.id)
    }

    return NextResponse.json({ quote: savedQuote, lead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update quote' },
      { status: 400 }
    )
  }
}
