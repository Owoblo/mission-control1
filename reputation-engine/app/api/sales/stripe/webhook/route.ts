import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSalesQuote, saveSalesQuote } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey) return new Response('Stripe not configured', { status: 503 })

  const body = await request.text()
  const sig = request.headers.get('stripe-signature') || ''

  let event: Stripe.Event
  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' })
    event = webhookSecret
      ? stripe.webhooks.constructEvent(body, sig, webhookSecret)
      : JSON.parse(body) as Stripe.Event
  } catch (err) {
    return new Response(`Webhook signature failed: ${err instanceof Error ? err.message : 'unknown'}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const quoteId = session.metadata?.quoteId
    if (quoteId) {
      try {
        const quote = await getSalesQuote(quoteId)
        if (quote) {
          const updatedQuote = {
            ...quote,
            depositPaidAt: new Date().toISOString(),
            depositPaidAmount: session.amount_total ? session.amount_total / 100 : quote.deposit,
            depositPaidMethod: 'stripe' as const,
            depositStripeSessionId: session.id,
            depositStripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
          }
          await saveSalesQuote(updatedQuote)
        }
      } catch { /* log error but don't fail */ }
    }
  }

  return NextResponse.json({ received: true })
}
