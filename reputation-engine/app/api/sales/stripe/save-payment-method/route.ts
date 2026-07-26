/**
 * POST /api/sales/stripe/save-payment-method
 * After client-side Stripe Elements confirmation, saves the payment method
 * and optionally charges the deposit. Uses raw fetch (no SDK).
 */
import { NextResponse } from 'next/server'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { ensureStripeCustomerForLead, stripeGet, stripePost } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, reusableStripeCustomerId, stripeErrorStatus } from '@/lib/server/stripe-accounts'

export async function POST(request: Request) {
  const session = await getSessionUser()

  try {
    const { leadId, quoteId, setupIntentId, customerId, chargeDepositNow } = (await request.json()) as {
      leadId: string
      quoteId?: string
      setupIntentId: string
      customerId: string
      chargeDepositNow?: boolean
    }

    const lead = await getSalesLead(leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to charge or save cards for this lead.' }, { status: 403 })
    }
    const quote = quoteId ? await getSalesQuote(quoteId) : null
    if (quoteId && !quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (quote && quote.leadId && quote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote does not belong to this lead.' }, { status: 400 })
    }
    const stripeAccount = requireStripeAccountForLead(lead)
    if (quote) assertQuoteStripeAccount(quote, stripeAccount.key)
    const stripeKey = stripeAccount.secretKey

    // Verify SetupIntent inside the selected branch account.
    const si = await stripeGet<{
      status?: string
      payment_method?: string
      customer?: string
      metadata?: Record<string, string>
      error?: { message?: string }
    }>(`setup_intents/${setupIntentId}`, stripeKey)
    if (si.status !== 'succeeded') {
      return NextResponse.json({ error: `Card not confirmed — status: ${si.status}` }, { status: 400 })
    }
    if ((si.metadata?.leadId || '') !== leadId) {
      return NextResponse.json({ error: 'This card collection session does not belong to the selected lead.' }, { status: 400 })
    }
    if (si.metadata?.stripeAccountKey !== stripeAccount.key) {
      return NextResponse.json({ error: 'Card session belongs to a different Stripe account.' }, { status: 409 })
    }

    const paymentMethodId = si.payment_method
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No payment method on setup intent' }, { status: 400 })
    }

    // Get card details (brand + last4)
    const pm = await stripeGet<{
      card?: { brand?: string; last4?: string }
    }>(`payment_methods/${paymentMethodId}`, stripeKey)
    const cardBrand = pm.card?.brand || 'card'
    const cardLast4 = pm.card?.last4 || '????'

    const { customerId: resolvedCustomerId } = await ensureStripeCustomerForLead(
      stripeKey,
      lead,
      si.customer || customerId || reusableStripeCustomerId(quote, stripeAccount.key),
      stripeAccount,
    )

    let depositCharged = false
    let depositAmount = 0
    let updatedQuote = quote

    if (chargeDepositNow && quoteId) {
      if (quote && quote.deposit > 0) {
        const piParams = new URLSearchParams()
        piParams.set('amount', String(Math.round(quote.deposit * 100)))
        piParams.set('currency', 'cad')
        piParams.set('customer', resolvedCustomerId)
        piParams.set('payment_method', paymentMethodId)
        piParams.set('confirm', 'true')
        piParams.set('off_session', 'true')
        piParams.set('description', `Deposit – ${quote.number} – ${lead.name}`)
        piParams.set('metadata[quoteId]', quote.id)
        piParams.set('metadata[leadId]', leadId)
        piParams.set('metadata[type]', 'deposit')
        appendStripeAccountMetadata(piParams, stripeAccount)

        const pi = await stripePost('payment_intents', stripeKey, piParams) as {
          id?: string; status?: string; error?: { message?: string }
        }

        if (pi.status === 'succeeded' && pi.id) {
          depositCharged = true
          depositAmount = quote.deposit
          const now = new Date().toISOString()
          updatedQuote = await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripePaymentIntentId: pi.id,
            depositStripeCustomerId: resolvedCustomerId,
            depositStripePaymentMethodId: paymentMethodId,
            depositStripeCardBrand: cardBrand,
            depositStripeCardLast4: cardLast4,
            stripeAccountKey: stripeAccount.key,
          })
        } else if (pi.error?.message) {
          return NextResponse.json({ error: pi.error.message }, { status: 402 })
        }
      }
    } else if (quoteId) {
      if (quote) {
        updatedQuote = await saveSalesQuote({
          ...quote,
          depositStripeCustomerId: resolvedCustomerId,
          depositStripePaymentMethodId: paymentMethodId,
          depositStripeCardBrand: cardBrand,
          depositStripeCardLast4: cardLast4,
          stripeAccountKey: stripeAccount.key,
        })
      }
    }

    const updatedLead = await saveSalesLead({
      ...lead,
      paymentStatus: depositCharged ? 'deposit_received' : lead.paymentStatus,
      depositAmount: depositCharged ? depositAmount : lead.depositAmount,
      depositMethod: depositCharged ? 'Credit Card' : lead.depositMethod,
      depositDate: depositCharged ? new Date().toISOString().slice(0, 10) : lead.depositDate,
    })

    if (quote && updatedQuote) {
      await recordQuoteUpdatedAudit(quote, updatedQuote, session?.name)
    }

    await recordLeadPaymentAudit({
      leadId,
      quoteId,
      actorName: session?.name,
      action: depositCharged ? 'deposit_charged' : 'card_saved',
      amount: depositCharged ? depositAmount : undefined,
      cardBrand,
      cardLast4,
      note: depositCharged
        ? 'Customer card was taken over the phone and charged immediately.'
        : 'Customer card was taken over the phone and saved on file.',
    })

    return NextResponse.json({
      ok: true,
      depositCharged,
      depositAmount,
      cardBrand,
      cardLast4,
      paymentMethodId,
      customerId: resolvedCustomerId,
      stripeAccountKey: stripeAccount.key,
      lead: updatedLead,
      quote: updatedQuote,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: stripeErrorStatus(err) })
  }
}
