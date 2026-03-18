/**
 * POST /api/sales/stripe/charge-balance
 * Charges the saved card for the remaining balance after job completion.
 * Uses raw fetch (no SDK) — same pattern as the checkout route.
 */
import { NextResponse } from 'next/server'
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
      amountOverride?: number
    }

    if (!leadId || !quoteId) {
      return NextResponse.json({ error: 'leadId and quoteId are required' }, { status: 400 })
    }

    const [leads, quote] = await Promise.all([listSalesLeads(), getSalesQuote(quoteId)])

    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const quoteRecord = quote as typeof quote & {
      depositStripePaymentMethodId?: string
      depositStripeCustomerId?: string
    }

    const paymentMethodId = quoteRecord.depositStripePaymentMethodId
    const customerId = quoteRecord.depositStripeCustomerId

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'No saved card on file. Customer must have paid the deposit by card.' },
        { status: 400 }
      )
    }

    const chargeAmount = amountOverride ?? quote.balance
    if (!chargeAmount || chargeAmount <= 0) {
      return NextResponse.json({ error: 'Balance amount is zero — nothing to charge.' }, { status: 400 })
    }

    const piParams = new URLSearchParams()
    piParams.set('amount', String(Math.round(chargeAmount * 100)))
    piParams.set('currency', 'cad')
    piParams.set('payment_method', paymentMethodId)
    if (customerId) piParams.set('customer', customerId)
    piParams.set('confirm', 'true')
    piParams.set('off_session', 'true')
    piParams.set('description', `Balance – ${quote.number} – ${lead.name}`)
    piParams.set('metadata[quoteId]', quote.id)
    piParams.set('metadata[leadId]', lead.id)
    piParams.set('metadata[type]', 'balance')

    const piRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: piParams.toString(),
    })
    const pi = await piRes.json() as { id?: string; status?: string; error?: { message?: string } }

    if (!piRes.ok || pi.error) {
      return NextResponse.json({ error: pi.error?.message || 'Charge failed' }, { status: 402 })
    }

    await saveSalesLead({ ...lead, paymentStatus: 'paid_in_full' })

    return NextResponse.json({ ok: true, paymentIntentId: pi.id, status: pi.status, amount: chargeAmount })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Charge failed' }, { status: 500 })
  }
}
