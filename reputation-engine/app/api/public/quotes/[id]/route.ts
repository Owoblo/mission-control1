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
import { uid, formatMoney, getDefaultPaymentTerms } from '@/lib/sales'
import { saveJobRecord } from '@/lib/server/repository'
import { readEnv, getAppBaseUrl } from '@/lib/server/runtime'
import type { CRMLead, CRMQuote } from '@/lib/types'

const CURRENT_QUOTE_TERMS_VERSION = '2026-06-07-basic-moving-terms'

async function sendQuoteNotification(event: 'viewed' | 'viewed_again' | 'accepted' | 'declined', quote: CRMQuote, lead: CRMLead | null) {
  const resendKey = readEnv('RESEND_API_KEY')
  if (!resendKey) return

  const customerName = lead?.name || 'Customer'
  const quoteNumber = quote.number || quote.id
  const total = quote.total ? formatMoney(quote.total) : 'N/A'
  const moveDate = quote.moveDate || 'TBD'
  const crmUrl = lead?.id ? `${getAppBaseUrl()}/sales/leads/${lead.id}` : null

  const subjects: Record<typeof event, string> = {
    viewed:       `👁 ${customerName} just viewed quote ${quoteNumber}`,
    viewed_again: `👁 ${customerName} viewed quote ${quoteNumber} again`,
    accepted:     `✅ ${customerName} ACCEPTED quote ${quoteNumber} — ${total}`,
    declined:     `❌ ${customerName} declined quote ${quoteNumber}`,
  }

  const intros: Record<typeof event, string> = {
    viewed:       `<b>${customerName}</b> opened their quote for the first time.`,
    viewed_again: `<b>${customerName}</b> viewed their quote again — they may be deciding.`,
    accepted:     `<b>${customerName}</b> accepted the quote and the move is now booked.`,
    declined:     `<b>${customerName}</b> declined the quote.`,
  }

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#071421">
      <div style="background:#071421;padding:20px 24px;border-radius:10px 10px 0 0">
        <span style="color:#C99700;font-weight:700;font-size:16px">Saturn Star Moving</span>
      </div>
      <div style="background:#f8f9fb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px">
        <p style="margin:0 0 16px;font-size:15px">${intros[event]}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#6b7280">Quote</td><td style="padding:6px 0;font-weight:600">${quoteNumber}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Total</td><td style="padding:6px 0;font-weight:600">${total}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Move date</td><td style="padding:6px 0;font-weight:600">${moveDate}</td></tr>
          ${lead?.phone ? `<tr><td style="padding:6px 0;color:#6b7280">Phone</td><td style="padding:6px 0">${lead.phone}</td></tr>` : ''}
          ${lead?.email ? `<tr><td style="padding:6px 0;color:#6b7280">Email</td><td style="padding:6px 0">${lead.email}</td></tr>` : ''}
        </table>
        ${crmUrl ? `<div style="margin-top:20px"><a href="${crmUrl}" style="background:#071421;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM →</a></div>` : ''}
      </div>
    </div>`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Saturn Star OS <business@starmovers.ca>',
      to: ['business@starmovers.ca'],
      subject: subjects[event],
      html,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {})
}

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
        void scheduleQuoteViewedFollowup(quote.leadId, quote.id).catch(() => null)
        void scheduleQuoteExpiryFollowup(quote.leadId, quote.id).catch(() => null)
        queueLeadIntelligenceRefresh(quote.leadId, new URL(request.url).origin)
      }

      // Notify team — first view vs repeat view
      const isRepeatView = !!currentQuote.viewedAt
      void sendQuoteNotification(isRepeatView ? 'viewed_again' : 'viewed', quote, lead)
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
        moveTime: quote.moveTime,
        moveType: quote.moveType,
        branch: lead?.branch,
        quoteType: quote.quoteType,
        jobLabel: quote.jobLabel,
        originCity: quote.originCity,
        originAddress: quote.originAddress,
        destCity: quote.destCity,
        destAddress: quote.destAddress || lead?.destAddress,
        crewSize: quote.crewSize,
        estimatedHours: quote.estimatedHours,
        truckCount: quote.truckCount,
        estimatedWeightLbs: quote.estimatedWeightLbs,
        billingModel: quote.billingModel,
        paymentTerms: quote.paymentTerms || getDefaultPaymentTerms(quote.moveType),
        minimumBillableHours: quote.minimumBillableHours,
        maximumEstimatedHours: quote.maximumEstimatedHours,
        hourlyRateOverride: quote.hourlyRateOverride,
        legs: quote.legs || [],
        jobFactors: lead?.jobFactors || undefined,
        moveDescription: quote.moveDescription,
        conditionalClause: quote.conditionalClause,
        status: quote.status,
        validDays: quote.validDays,
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
        termsAcceptedAt: quote.termsAcceptedAt,
        termsAcceptedVersion: quote.termsAcceptedVersion,
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
        inventory: (lead.inventory || []).filter((item: { included?: boolean }) => item.included !== false),
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
    const body = (await request.json()) as {
      token?: string
      action?: 'accept' | 'decline'
      termsAccepted?: boolean
      termsVersion?: string
    }
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
    if (action === 'accept' && !quote.termsAcceptedAt && body.termsAccepted !== true) {
      return NextResponse.json({ error: 'Terms must be accepted before booking.' }, { status: 400 })
    }

    const acceptedTermsVersion = body.termsVersion || CURRENT_QUOTE_TERMS_VERSION
    const headers = request.headers
    const nextQuote = await saveSalesQuote({
      ...quote,
      status: action === 'decline' ? 'declined' : 'accepted',
      viewedAt: quote.viewedAt || eventDate,
      acceptedAt: action === 'accept' ? quote.acceptedAt || eventDate : quote.acceptedAt,
      respondedAt: quote.respondedAt || now.toISOString(),
      termsAcceptedAt: action === 'accept' ? quote.termsAcceptedAt || now.toISOString() : quote.termsAcceptedAt,
      termsAcceptedVersion: action === 'accept' ? quote.termsAcceptedVersion || acceptedTermsVersion : quote.termsAcceptedVersion,
      termsAcceptedIp: action === 'accept'
        ? quote.termsAcceptedIp || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || undefined
        : quote.termsAcceptedIp,
      termsAcceptedUserAgent: action === 'accept' ? quote.termsAcceptedUserAgent || headers.get('user-agent') || undefined : quote.termsAcceptedUserAgent,
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

    // Notify team on accept or decline
    void sendQuoteNotification(action === 'accept' ? 'accepted' : 'declined', nextQuote, savedLead)

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
