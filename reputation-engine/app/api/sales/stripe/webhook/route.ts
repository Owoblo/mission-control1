import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSalesQuote, listSalesLeads, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey) return new Response('Stripe not configured', { status: 503 })

  const body = await request.text()
  const sig = request.headers.get('stripe-signature') || ''

  let event: Stripe.Event
  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover', httpClient: Stripe.createNodeHttpClient() })
    event = webhookSecret
      ? stripe.webhooks.constructEvent(body, sig, webhookSecret)
      : JSON.parse(body) as Stripe.Event
  } catch (err) {
    return new Response(`Webhook signature failed: ${err instanceof Error ? err.message : 'unknown'}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const quoteId = session.metadata?.quoteId
    const leadId = session.metadata?.leadId

    if (quoteId) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover', httpClient: Stripe.createNodeHttpClient() })
        const now = new Date().toISOString()

        // Retrieve payment intent to get payment method ID for future balance charge
        let paymentMethodId: string | undefined
        let customerId: string | undefined
        if (session.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(
            typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id
          )
          paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id
          customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id
        }

        // Update the quote with deposit payment info
        const quote = await getSalesQuote(quoteId)
        if (quote) {
          await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: session.amount_total ? session.amount_total / 100 : quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripeSessionId: session.id,
            depositStripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            depositStripeCustomerId: customerId,
            depositStripePaymentMethodId: paymentMethodId,
          })
        }

        // Update the lead: mark deposit received, save Stripe IDs for balance charge
        const targetLeadId = leadId || quote?.leadId
        if (targetLeadId) {
          const leads = await listSalesLeads()
          const lead = leads.find(l => l.id === targetLeadId)
          if (lead) {
            await saveSalesLead({
              ...lead,
              paymentStatus: 'deposit_received',
              depositAmount: session.amount_total ? session.amount_total / 100 : quote?.deposit,
              depositMethod: 'Credit Card',
              depositDate: now.slice(0, 10),
            })
          }
        }
      } catch (err) {
        console.error('Stripe webhook processing error:', err)
        // Don't fail — Stripe will retry if we return non-200
      }
    }
  }

  return NextResponse.json({ received: true })
}
