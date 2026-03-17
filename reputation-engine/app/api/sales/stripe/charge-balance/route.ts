/**
 * POST /api/sales/stripe/charge-balance
 * Charges the saved card for the remaining balance after job completion.
 * Requires the lead to have paymentStatus = 'deposit_received' and a
 * depositStripePaymentMethodId saved from the original deposit checkout.
 * Internal use only — requires session auth.
 */
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { hasInternalSession } from '@/lib/server/session'
import { getSalesQuote, listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  try {
    const { leadId, quoteId, amountOverride } = (await request.json()) as {
      leadId: string
      quoteId: string
      amountOverride?: number   // optional — defaults to quote.balance
    }

    if (!leadId || !quoteId) {
      return NextResponse.json({ error: 'leadId and quoteId are required' }, { status: 400 })
    }

    const [leads, quote] = await Promise.all([listSalesLeads(), getSalesQuote(quoteId)])

    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Get the saved payment method from the deposit transaction
    const quoteRecord = quote as typeof quote & {
      depositStripePaymentMethodId?: string
      depositStripeCustomerId?: string
    }

    const paymentMethodId = quoteRecord.depositStripePaymentMethodId
    const customerId = quoteRecord.depositStripeCustomerId

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'No saved card on file. Customer must have paid the deposit by card to enable this.' },
        { status: 400 }
      )
    }

    const chargeAmount = amountOverride ?? quote.balance
    if (!chargeAmount || chargeAmount <= 0) {
      return NextResponse.json({ error: 'Balance amount is zero — nothing to charge.' }, { status: 400 })
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' })

    // Create off-session payment intent using saved card
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(chargeAmount * 100),
      currency: 'cad',
      payment_method: paymentMethodId,
      customer: customerId,
      confirm: true,
      off_session: true,
      description: `Balance charge – ${quote.number} – ${lead.name}`,
      metadata: { quoteId: quote.id, leadId: lead.id, type: 'balance' },
    })

    const now = new Date().toISOString()
    await saveSalesLead({
      ...lead,
      paymentStatus: 'paid_in_full',
    })

    return NextResponse.json({
      ok: true,
      paymentIntentId: pi.id,
      status: pi.status,
      amount: chargeAmount,
    })
  } catch (err) {
    // Stripe authentication errors (card declined etc.) come as StripeError
    const message = err instanceof Error ? err.message : 'Charge failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
