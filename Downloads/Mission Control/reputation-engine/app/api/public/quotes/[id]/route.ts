import { NextResponse } from 'next/server'
import { syncLeadFromQuoteStatus } from '@/lib/sales'
import {
  getSalesClient,
  getSalesLead,
  getSalesQuote,
  saveFollowUpLog,
  saveSalesLead,
  saveSalesQuote,
} from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'
import { saveJobRecord } from '@/lib/server/repository'

function isTokenValid(token: string | null, expected?: string) {
  return !!token && !!expected && token === expected
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const token = new URL(request.url).searchParams.get('token')
    const currentQuote = await getSalesQuote(params.id)

    if (!currentQuote || !isTokenValid(token, currentQuote.acceptToken)) {
      return NextResponse.json({ error: 'Quote link is invalid or expired' }, { status: 404 })
    }

    const viewedStamp = new Date().toISOString()
    const quote =
      currentQuote.status === 'draft' || currentQuote.status === 'sent'
        ? await saveSalesQuote({
            ...currentQuote,
            status: currentQuote.status === 'draft' ? 'viewed' : 'viewed',
            viewedAt: currentQuote.viewedAt || viewedStamp.slice(0, 10),
          })
        : currentQuote

    const [client, lead] = await Promise.all([
      getSalesClient(quote.clientId),
      quote.leadId ? getSalesLead(quote.leadId) : Promise.resolve(null),
    ])

    await saveFollowUpLog({
      id: uid('fu'),
      quoteId: quote.id,
      leadId: quote.leadId,
      type: 'view',
      date: viewedStamp,
      createdAt: viewedStamp,
      notes: 'Public quote page viewed.',
    })

    if (lead && quote.leadId && (lead.stage === 'pricing' || lead.stage === 'contacted' || lead.stage === 'new')) {
      await saveSalesLead(syncLeadFromQuoteStatus(lead, quote))
    }

    return NextResponse.json({
      quote: {
        id: quote.id,
        number: quote.number,
        moveDate: quote.moveDate,
        originCity: quote.originCity,
        destCity: quote.destCity,
        status: quote.status,
        validDays: quote.validDays,
        lineItems: quote.lineItems,
        subtotal: quote.subtotal,
        hst: quote.hst,
        total: quote.total,
        deposit: quote.deposit,
        balance: quote.balance,
        createdAt: quote.createdAt,
        viewedAt: quote.viewedAt,
        acceptedAt: quote.acceptedAt,
      },
      client: client ? { name: client.name, email: client.email, phone: client.phone } : null,
      lead: lead ? { name: lead.name } : null,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load quote' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as { token?: string; action?: 'accept' | 'decline' }
    const quote = await getSalesQuote(params.id)

    if (!quote || !isTokenValid(body.token || null, quote.acceptToken)) {
      return NextResponse.json({ error: 'Quote link is invalid or expired' }, { status: 404 })
    }

    const action = body.action || 'accept'

    if (action === 'accept' && (quote.status === 'accepted' || quote.status === 'invoiced' || quote.acceptedAt)) {
      return NextResponse.json({ error: 'Quote has already been accepted' }, { status: 409 })
    }

    if (action === 'decline' && quote.status === 'declined') {
      return NextResponse.json({ error: 'Quote has already been declined' }, { status: 409 })
    }

    const now = new Date()
    const eventDate = now.toISOString().slice(0, 10)
    const nextQuote = await saveSalesQuote({
      ...quote,
      status: action === 'decline' ? 'declined' : 'accepted',
      viewedAt: quote.viewedAt || eventDate,
      acceptedAt: action === 'accept' ? quote.acceptedAt || eventDate : quote.acceptedAt,
      respondedAt: quote.respondedAt || now.toISOString(),
    })

    let savedLead = null
    if (nextQuote.leadId) {
      const lead = await getSalesLead(nextQuote.leadId)
      if (lead) {
        savedLead = await saveSalesLead(
          syncLeadFromQuoteStatus(
            {
              ...lead,
              followUpDate: action === 'accept' ? undefined : lead.followUpDate,
            },
            nextQuote
          )
        )
      }
    }

    await saveFollowUpLog({
      id: uid('fu'),
      quoteId: nextQuote.id,
      leadId: nextQuote.leadId,
      type: action === 'decline' ? 'decline' : 'accept',
      date: now.toISOString(),
      createdAt: now.toISOString(),
      notes: action === 'decline' ? 'Customer declined quote from public link.' : 'Customer accepted quote from public link.',
    })

    if (action === 'accept') {
      try {
        const client = await getSalesClient(nextQuote.clientId)
        const customerName = savedLead?.name || client?.name || 'Customer'
        const customerEmail = client?.email || ''
        const customerPhone = client?.phone || savedLead?.phone || ''
        await saveJobRecord({
          id: uid('job'),
          customerName,
          customerEmail,
          customerPhone,
          moveDate: nextQuote.moveDate || now.toISOString().slice(0, 10),
          moveFrom: savedLead?.originCity || nextQuote.originCity || '',
          moveTo: savedLead?.destCity || nextQuote.destCity || '',
          crewLead: '',
          status: 'pending',
          reviews: { google: false, yelp: false, facebook: false, media: false },
          reviewConfirmedAt: {},
          incentiveEarned: false,
          incentivePaid: false,
          proofSentToPartner: false,
          createdAt: now.toISOString(),
        })
      } catch {
        // Non-fatal: job record creation failure should not block the accept response
      }
    }

    return NextResponse.json({ ok: true, quote: nextQuote, lead: savedLead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to accept quote' },
      { status: 400 }
    )
  }
}
