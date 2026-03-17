import { NextResponse } from 'next/server'
import Stripe from 'stripe'
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

    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' })
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://mission-control1-reputation-engine.vercel.app'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `Saturn Star Moving — Deposit for ${quote.number}`,
              description: `Booking deposit (${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'})`,
            },
            unit_amount: Math.round(quote.deposit * 100), // cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        quoteId: quote.id,
        quoteNumber: quote.number,
      },
      success_url: successUrl || `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}&paid=1`,
      cancel_url: cancelUrl || `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`,
    })

    return NextResponse.json({ url: session.url, sessionId: session.id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: 500 })
  }
}
