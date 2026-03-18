/**
 * POST /api/sales/stripe/save-payment-method
 * After client-side Stripe Elements confirmation, saves the payment method
 * details to the lead's quote so we can charge deposit + balance later.
 */
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { hasInternalSession } from '@/lib/server/session'
import { getSalesQuote, listSalesLeads, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  try {
    const { leadId, quoteId, setupIntentId, customerId, chargeDepositNow } = (await request.json()) as {
      leadId: string
      quoteId?: string
      setupIntentId: string
      customerId: string
      chargeDepositNow?: boolean
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

    // Confirm the SetupIntent is succeeded and get the payment method
    const si = await stripe.setupIntents.retrieve(setupIntentId)
    if (si.status !== 'succeeded') {
      return NextResponse.json({ error: `Card not confirmed — status: ${si.status}` }, { status: 400 })
    }

    const paymentMethodId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No payment method on setup intent' }, { status: 400 })
    }

    // Get payment method details for display (last4, brand)
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
    const cardBrand = pm.card?.brand || 'card'
    const cardLast4 = pm.card?.last4 || '????'

    const leads = await listSalesLeads()
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    let depositCharged = false
    let depositAmount = 0

    // Optionally charge the deposit immediately
    if (chargeDepositNow && quoteId) {
      const quote = await getSalesQuote(quoteId)
      if (quote && quote.deposit > 0) {
        const pi = await stripe.paymentIntents.create({
          amount: Math.round(quote.deposit * 100),
          currency: 'cad',
          customer: customerId,
          payment_method: paymentMethodId,
          confirm: true,
          off_session: true,
          description: `Deposit – ${quote.number} – ${lead.name}`,
          metadata: { quoteId: quote.id, leadId, type: 'deposit' },
        })

        if (pi.status === 'succeeded') {
          depositCharged = true
          depositAmount = quote.deposit
          const now = new Date().toISOString()
          await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripePaymentIntentId: pi.id,
            depositStripeCustomerId: customerId,
            depositStripePaymentMethodId: paymentMethodId,
          })
        }
      }
    } else if (quoteId) {
      // Just save the card — don't charge yet
      const quote = await getSalesQuote(quoteId)
      if (quote) {
        await saveSalesQuote({
          ...quote,
          depositStripeCustomerId: customerId,
          depositStripePaymentMethodId: paymentMethodId,
        })
      }
    }

    // Update lead payment status
    const updatedLead = await saveSalesLead({
      ...lead,
      paymentStatus: depositCharged ? 'deposit_received' : lead.paymentStatus,
      depositAmount: depositCharged ? depositAmount : lead.depositAmount,
      depositMethod: depositCharged ? 'Credit Card' : lead.depositMethod,
      depositDate: depositCharged ? new Date().toISOString().slice(0, 10) : lead.depositDate,
    })

    return NextResponse.json({
      ok: true,
      depositCharged,
      depositAmount,
      cardBrand,
      cardLast4,
      paymentMethodId,
      customerId,
      lead: updatedLead,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
  }
}
