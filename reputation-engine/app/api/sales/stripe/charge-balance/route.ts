/**
 * POST /api/sales/stripe/charge-balance
 * Charges the saved card for the remaining balance after job completion.
 * Uses raw fetch (no SDK) — same pattern as the checkout route.
 */
import { NextResponse } from 'next/server'
import { getQuotePaidSoFar } from '@/lib/server/job-billing'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { fetchStripeCardSummary, stripePost } from '@/lib/server/stripe-payments'
import { readEnv } from '@/lib/server/runtime'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

export async function POST(request: Request) {
  const session = await getSessionUser()

  const stripeKey = readEnv('STRIPE_SECRET_KEY')
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

    const [lead, quote] = await Promise.all([getSalesLead(leadId), getSalesQuote(quoteId)])

    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (quote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote does not belong to this lead.' }, { status: 400 })
    }
    if (!canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to charge cards for this lead.' }, { status: 403 })
    }

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

    const pi = await stripePost<{
      id?: string
      status?: string
      error?: { message?: string }
    }>('payment_intents', stripeKey, piParams)

    if (pi.status !== 'succeeded' || !pi.id) {
      return NextResponse.json({ error: pi.error?.message || 'Charge failed' }, { status: 402 })
    }

    const paid = getQuotePaidSoFar(quote, lead)
    const nextBalance = Math.max(0, Math.round((quote.total - (paid.totalPaid + chargeAmount)) * 100) / 100)
    const updatedQuote = await saveSalesQuote({
      ...quote,
      balance: nextBalance,
      balancePaidAt: new Date().toISOString(),
      balancePaidAmount: Math.round((paid.balancePaid + chargeAmount) * 100) / 100,
      balancePaidMethod: 'stripe',
    })

    const updatedLead = await saveSalesLead({
      ...lead,
      paymentStatus: nextBalance <= 0 ? 'paid_in_full' : 'deposit_received',
    })

    const { cardBrand, cardLast4 } = await fetchStripeCardSummary(stripeKey, paymentMethodId)
    await recordQuoteUpdatedAudit(quote, updatedQuote, session?.name)
    await recordLeadPaymentAudit({
      leadId,
      quoteId,
      actorName: session?.name,
      action: 'balance_charged',
      amount: chargeAmount,
      cardBrand,
      cardLast4,
      note: nextBalance > 0 ? `Remaining balance is now ${nextBalance.toFixed(2)}.` : 'Move is now paid in full.',
    })

    return NextResponse.json({
      ok: true,
      paymentIntentId: pi.id,
      status: pi.status,
      amount: chargeAmount,
      balance: nextBalance,
      lead: updatedLead,
      quote: updatedQuote,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Charge failed' }, { status: 500 })
  }
}
