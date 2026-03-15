import { NextResponse } from 'next/server'
import { dateStamp, normalizeQuote, syncLeadFromQuoteStatus } from '@/lib/sales'
import { getSalesClient, getSalesLead, getSalesQuote, listFollowUpLogs, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
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
      client,
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
    const current = await getSalesQuote(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const updates = (await request.json()) as Partial<typeof current>
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
      const currentLead = await getSalesLead(savedQuote.leadId)
      if (currentLead) {
        lead = await saveSalesLead(syncLeadFromQuoteStatus(currentLead, savedQuote))
      }
    }

    return NextResponse.json({ quote: savedQuote, lead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update quote' },
      { status: 400 }
    )
  }
}
