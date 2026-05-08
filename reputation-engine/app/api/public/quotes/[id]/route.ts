import { NextResponse } from 'next/server'
import { syncLeadFromQuoteStatus } from '@/lib/sales'
import { logEvent, daysBetween } from '@/lib/server/analytics'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'
import { scheduleQuoteExpiryFollowup, scheduleQuoteViewedFollowup } from '@/lib/server/sales-automation'
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
    const searchParams = new URL(request.url).searchParams
    const token = searchParams.get('token')
    const isPreview = searchParams.get('preview') === '1'
    const currentQuote = await getSalesQuote(params.id)

    if (!currentQuote || !isTokenValid(token, currentQuote.acceptToken)) {
      return NextResponse.json({ error: 'Quote link is invalid or expired' }, { status: 404 })
    }

    const viewedStamp = new Date().toISOString()
    // Skip marking as viewed when opened as internal preview (avoids false positives)
    const quote = (!isPreview && (currentQuote.status === 'draft' || currentQuote.status === 'sent'))
      ? await saveSalesQuote({
          ...currentQuote,
          status: 'viewed',
          viewedAt: currentQuote.viewedAt || viewedStamp,
        })
      : currentQuote

    const [client, lead] = await Promise.all([
      getSalesClient(quote.clientId),
      quote.leadId ? getSalesLead(quote.leadId) : Promise.resolve(null),
    ])

    if (!isPreview) {
      await saveFollowUpLog({
        id: uid('fu'),
        quoteId: quote.id,
        leadId: quote.leadId,
        type: 'view',
        date: viewedStamp,
        createdAt: viewedStamp,
        notes: 'Customer viewed quote.',
      })

      if (lead && quote.leadId && (lead.stage === 'pricing' || lead.stage === 'contacted' || lead.stage === 'new')) {
        await saveSalesLead(syncLeadFromQuoteStatus(lead, quote))
      }

      if (quote.leadId) {
        void scheduleQuoteViewedFollowup(quote.leadId, quote.id)
        void scheduleQuoteExpiryFollowup(quote.leadId, quote.id)
        queueLeadIntelligenceRefresh(quote.leadId, new URL(request.url).origin)
      }
    }

    void logEvent('quote_viewed', {
      leadId: quote.leadId,
      actorName: 'Customer',
      lead: lead || undefined,
      quote,
      properties: {
        days_since_created: lead ? daysBetween(lead.createdAt, new Date().toISOString()) : undefined,
      },
    })

    return NextResponse.json({
      quote: {
        id: quote.id,
        number: quote.number,
        moveDate: quote.moveDate,
        moveType: quote.moveType,
        crewSize: quote.crewSize,
        estimatedHours: quote.estimatedHours,
        truckCount: quote.truckCount,
        billingModel: quote.billingModel,
        minimumBillableHours: quote.minimumBillableHours,
        maximumEstimatedHours: quote.maximumEstimatedHours,
        hourlyRateOverride: quote.hourlyRateOverride,
        originCity: quote.originCity,
        originAddress: quote.originAddress,
        destCity: quote.destCity,
        destAddress: lead?.destAddress,
        status: quote.status,
        validDays: quote.validDays,
        moveDescription: quote.moveDescription,
        lineItems: quote.lineItems,
        subtotal: quote.subtotal,
        hst: quote.hst,
        total: quote.total,
        deposit: quote.deposit,
        balance: quote.balance,
        discountAmount: quote.discountAmount,
        discountLabel: quote.discountLabel,
        createdAt: quote.createdAt,
        viewedAt: quote.viewedAt,
        acceptedAt: quote.acceptedAt,
        respondedAt: quote.respondedAt,
      },
      client: lead
        ? {
            name: lead.name || client?.name || '',
            email: lead.email || client?.email || '',
            phone: lead.phone || client?.phone || '',
          }
        : client
          ? { name: client.name, email: client.email, phone: client.phone }
          : null,
      lead: lead ? {
        name: lead.name,
        inventory: (lead.inventory || []).filter((item: { included?: boolean }) => item.included !== false).slice(0, 60),
        listingPhotos: ((lead.supabaseListing as { carouselphotos?: Array<{ url: string } | string> } | null)?.carouselphotos || [])
          .slice(0, 12)
          .map((p: { url: string } | string) => typeof p === 'string' ? p : p.url)
          .filter(Boolean),
        jobFactors: lead.jobFactors || null,
      } : null,
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

    void logEvent(action === 'accept' ? 'quote_accepted' : 'quote_declined', {
      leadId: nextQuote.leadId,
      actorName: 'Customer',
      lead: savedLead || undefined,
      quote: nextQuote,
      properties: {
        days_from_lead_to_booked: savedLead ? daysBetween(savedLead.createdAt, new Date().toISOString()) : undefined,
        touchpoints_to_close: savedLead ? (savedLead.callLogs || []).length : undefined,
      },
    })

    return NextResponse.json({ ok: true, quote: nextQuote, lead: savedLead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to accept quote' },
      { status: 400 }
    )
  }
}
