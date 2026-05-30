import { NextResponse } from 'next/server'
import { getSalesQuote, listSalesLeads } from '@/lib/server/sales-repository'
import { getAppBaseUrl, readEnv } from '@/lib/server/runtime'
import { hasInternalSession } from '@/lib/server/session'

export async function POST(request: Request) {
  const stripeKey = readEnv('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 })
  }

  try {
    const { quoteId, token, successUrl, cancelUrl } = (await request.json()) as {
      quoteId: string
      token?: string
      successUrl?: string
      cancelUrl?: string
    }

    if (!quoteId) return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })

    let quote = await getSalesQuote(quoteId)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    const authed = await hasInternalSession()
    if (!authed && (!token || token !== quote.acceptToken)) {
      return NextResponse.json({ error: 'Quote link is invalid or expired' }, { status: 404 })
    }

    // Fast Lane quotes (status='sent', internalNotes starts with 'Fast Lane') auto-accept
    // on checkout — no intermediate accept step needed for hourly rate quotes
    const isFastLane = quote.internalNotes?.startsWith('Fast Lane')
    if (quote.status === 'sent' && isFastLane) {
      const { saveSalesQuote: saveQ } = await import('@/lib/server/sales-repository')
      quote = await saveQ({
        ...quote,
        status: 'accepted',
        acceptedAt: new Date().toISOString().slice(0, 10),
        respondedAt: new Date().toISOString(),
      })
    }

    if (quote.status !== 'accepted') {
      return NextResponse.json({ error: 'Quote must be accepted before paying deposit' }, { status: 400 })
    }

    // Find the linked lead for customer info + leadId in metadata
    const leads = await listSalesLeads()
    const lead = leads.find(l => l.id === quote.leadId)

    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    const returnBase = `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`
    const safeSuccessUrl = successUrl?.startsWith(appUrl) ? successUrl : `${returnBase}&paid=1`
    const safeCancelUrl = cancelUrl?.startsWith(appUrl) ? cancelUrl : returnBase

    // Build Stripe checkout session via REST API (no SDK needed)
    const params = new URLSearchParams()
    params.set('mode', 'payment')
    params.set('payment_method_types[0]', 'card')

    // Save the card on file for balance charge after job
    params.set('payment_intent_data[setup_future_usage]', 'off_session')
    params.set('payment_intent_data[description]', `Deposit – ${quote.number} – ${lead?.name || 'Customer'}`)
    params.set('payment_intent_data[metadata][quoteId]', quote.id)
    params.set('payment_intent_data[metadata][quoteNumber]', quote.number)
    if (lead?.id) params.set('payment_intent_data[metadata][leadId]', lead.id)

    // Pre-fill customer email so Stripe receipt goes to customer
    const customerEmail = lead?.email
    if (customerEmail) params.set('customer_email', customerEmail)

    params.set('line_items[0][price_data][currency]', 'cad')
    params.set('line_items[0][price_data][product_data][name]', `Saturn Star Moving — ${quote.number} Deposit`)
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Booking deposit (${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'}). Card saved on file for balance after move.`
    )
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(quote.deposit * 100)))
    params.set('line_items[0][quantity]', '1')

    // Metadata on session for webhook
    params.set('metadata[quoteId]', quote.id)
    params.set('metadata[quoteNumber]', quote.number)
    if (lead?.id) params.set('metadata[leadId]', lead.id)

    params.set('success_url', safeSuccessUrl)
    params.set('cancel_url', safeCancelUrl)

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await stripeResponse.json() as {
      id?: string
      url?: string
      error?: { message?: string }
    }

    if (!stripeResponse.ok || !session.url) {
      return NextResponse.json({ error: session.error?.message || 'Stripe session creation failed' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: 500 })
  }
}
