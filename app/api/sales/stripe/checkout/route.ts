import { NextResponse } from 'next/server'
import { getSalesQuote } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to your environment variables.' }, { status: 503 })
  }

  try {
    const { quoteId, successUrl, cancelUrl } = (await request.json()) as {
      quoteId: string
      successUrl?: string
      cancelUrl?: string
    }

    if (!quoteId) return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })

    const quote = await getSalesQuote(quoteId)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (quote.status !== 'accepted') {
      return NextResponse.json({ error: 'Quote must be accepted before paying deposit' }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://mission-control1-reputation-engine.vercel.app'
    const params = new URLSearchParams()
    params.set('payment_method_types[0]', 'card')
    params.set('mode', 'payment')
    params.set('line_items[0][price_data][currency]', 'cad')
    params.set('line_items[0][price_data][product_data][name]', `Saturn Star Moving - Deposit for ${quote.number}`)
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Booking deposit (${quote.originCity || 'Origin'} -> ${quote.destCity || 'Destination'})`
    )
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(quote.deposit * 100)))
    params.set('line_items[0][quantity]', '1')
    params.set('metadata[quoteId]', quote.id)
    params.set('metadata[quoteNumber]', quote.number)
    params.set(
      'success_url',
      successUrl || `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}&paid=1`
    )
    params.set(
      'cancel_url',
      cancelUrl || `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`
    )

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await stripeResponse.json() as { id?: string; url?: string; error?: { message?: string; type?: string } }
    if (!stripeResponse.ok || !session.url || !session.id) {
      const message = session.error?.message || 'Stripe checkout session creation failed'
      return NextResponse.json({ error: message }, { status: stripeResponse.status || 502 })
    }

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: 500 })
  }
}
