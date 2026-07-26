/**
 * POST /api/sales/stripe/setup-intent
 * Creates a Stripe SetupIntent so we can collect and save card details
 * directly in the CRM without redirecting to Stripe Checkout.
 * Uses raw fetch (no SDK) — same pattern as the checkout route.
 */
import { NextResponse } from 'next/server'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { ensureStripeCustomerForLead, stripePost } from '@/lib/server/stripe-payments'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, reusableStripeCustomerId, stripeErrorStatus } from '@/lib/server/stripe-accounts'
import { getLatestSalesQuoteByLeadId, getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

export async function POST(request: Request) {
  const session = await getSessionUser()

  try {
    const { leadId, quoteId } = (await request.json()) as { leadId: string; quoteId?: string }
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

    const lead = await getSalesLead(leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to collect payment details for this lead.' }, { status: 403 })
    }

    const scopedQuote = quoteId ? await getSalesQuote(quoteId).catch(() => null) : null
    if (quoteId && !scopedQuote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }
    if (scopedQuote && scopedQuote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote does not belong to this lead.' }, { status: 400 })
    }

    const latestQuote = scopedQuote || await getLatestSalesQuoteByLeadId(leadId).catch(() => null)
    const stripeAccount = requireStripeAccountForLead(lead)
    if (latestQuote) assertQuoteStripeAccount(latestQuote, stripeAccount.key)
    const stripeKey = stripeAccount.secretKey
    const preferredCustomerId = reusableStripeCustomerId(latestQuote, stripeAccount.key)
    const { customerId } = await ensureStripeCustomerForLead(stripeKey, lead, preferredCustomerId, stripeAccount)

    // Create SetupIntent
    const siParams = new URLSearchParams()
    siParams.set('customer', customerId)
    siParams.set('payment_method_types[0]', 'card')
    siParams.set('usage', 'off_session')
    siParams.set('metadata[leadId]', leadId)
    if (quoteId) siParams.set('metadata[quoteId]', quoteId)
    appendStripeAccountMetadata(siParams, stripeAccount)

    const si = await stripePost('setup_intents', stripeKey, siParams) as { id?: string; client_secret?: string; error?: { message?: string } }
    if (!si.client_secret) {
      return NextResponse.json({ error: si.error?.message || 'Could not create SetupIntent' }, { status: 502 })
    }

    return NextResponse.json({
      clientSecret: si.client_secret,
      customerId,
      setupIntentId: si.id,
      publishableKey: stripeAccount.publishableKey,
      stripeAccountKey: stripeAccount.key,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setup failed' }, { status: stripeErrorStatus(err) })
  }
}
