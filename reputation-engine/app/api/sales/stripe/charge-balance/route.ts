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
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'

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
    if (lead.email) piParams.set('receipt_email', lead.email)
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

    const cardLabel = cardBrand && cardLast4 ? `${cardBrand} ••••${cardLast4}` : 'card on file'
    void sendRepAlertEmail(
      `💳 Balance charged — ${lead.name} — $${chargeAmount.toFixed(2)} CAD`,
      `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <div style="background:#1a2744;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
          Balance charged — ${lead.name}
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px;font-size:14px;color:#1a2744">
          <p style="margin:0 0 12px"><strong>Amount charged:</strong> $${chargeAmount.toFixed(2)} CAD</p>
          <p style="margin:0 0 12px"><strong>Card:</strong> ${cardLabel}</p>
          <p style="margin:0 0 12px"><strong>Quote:</strong> ${quote.number}</p>
          <p style="margin:0 0 12px"><strong>Remaining balance:</strong> $${nextBalance.toFixed(2)} CAD${nextBalance <= 0 ? ' — <strong>Paid in full ✓</strong>' : ''}</p>
          <p style="margin:0 0 12px"><strong>Charged by:</strong> ${session?.name || 'CRM'}</p>
          <p style="margin:0"><a href="https://go.quote2move.com/sales/leads/${leadId}" style="color:#1a2744;font-weight:600">View lead →</a></p>
        </div>
      </div>`
    )

    return NextResponse.json({
      ok: true,
      paymentIntentId: pi.id,
      status: pi.status,
      amount: chargeAmount,
      balance: nextBalance,
      cardLast4,
      cardBrand,
      lead: updatedLead,
      quote: updatedQuote,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Charge failed' }, { status: 500 })
  }
}
