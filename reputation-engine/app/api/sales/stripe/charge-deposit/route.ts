import { NextResponse } from 'next/server'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { fetchStripeCardSummary, stripePost } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { buildPaymentRecord } from '@/lib/payment-records'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, stripeErrorStatus } from '@/lib/server/stripe-accounts'

export async function POST(request: Request) {
  const session = await getSessionUser()

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

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (quote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote does not belong to this lead.' }, { status: 400 })
    }
    if (!canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to charge cards for this lead.' }, { status: 403 })
    }
    const stripeAccount = requireStripeAccountForLead(lead)
    assertQuoteStripeAccount(quote, stripeAccount.key)
    if (!quote.stripeAccountKey && stripeAccount.key === 'dexa' && (quote.depositStripePaymentMethodId || quote.depositStripeCustomerId)) {
      return NextResponse.json({ error: 'Legacy card belongs to the Saturn account. Collect a new card in Dexa Stripe.' }, { status: 409 })
    }
    const stripeKey = stripeAccount.secretKey

    const paymentMethodId = (quote.depositStripePaymentMethodId || '').trim()
    const customerId = (quote.depositStripeCustomerId || '').trim()
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No saved card on file. Take a card by phone first.' }, { status: 400 })
    }

    const chargeAmount = Math.round(Number(amountOverride ?? quote.deposit) * 100) / 100
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0) {
      return NextResponse.json({ error: 'Deposit amount must be greater than zero.' }, { status: 400 })
    }

    const piParams = new URLSearchParams()
    piParams.set('amount', String(Math.round(chargeAmount * 100)))
    piParams.set('currency', 'cad')
    piParams.set('payment_method', paymentMethodId)
    if (customerId) piParams.set('customer', customerId)
    piParams.set('confirm', 'true')
    piParams.set('off_session', 'true')
    piParams.set('description', `Deposit – ${quote.number} – ${lead.name}`)
    if (lead.email) piParams.set('receipt_email', lead.email)
    piParams.set('metadata[quoteId]', quote.id)
    piParams.set('metadata[leadId]', lead.id)
    piParams.set('metadata[type]', 'deposit')
    appendStripeAccountMetadata(piParams, stripeAccount)

    const pi = await stripePost<{
      id?: string
      status?: string
      error?: { message?: string }
    }>('payment_intents', stripeKey, piParams)

    const { cardBrand, cardLast4 } = await fetchStripeCardSummary(stripeKey, paymentMethodId)

    if (pi.status !== 'succeeded' || !pi.id) {
      await recordLeadPaymentAudit({
        leadId,
        quoteId,
        actorName: session?.name,
        action: 'deposit_charge_attempt',
        amount: chargeAmount,
        cardBrand,
        cardLast4,
        note: pi.error?.message || 'Stripe did not return a successful deposit charge.',
      })
      return NextResponse.json({ error: pi.error?.message || 'Charge failed' }, { status: 402 })
    }

    const now = new Date().toISOString()
    const paymentRecord = buildPaymentRecord({ quote, lead, amount: chargeAmount, kind: 'deposit', method: 'credit_card', paidAt: now, reference: pi.id, cardLast4, recordedBy: session?.name, recordedByUserId: session?.userId })
    const updatedQuote = await saveSalesQuote({
      ...quote,
      depositPaidAt: now,
      depositPaidAmount: chargeAmount,
      depositPaidMethod: 'stripe',
      depositStripePaymentIntentId: pi.id,
      depositStripeCustomerId: customerId || quote.depositStripeCustomerId,
      depositStripePaymentMethodId: paymentMethodId,
      depositStripeCardBrand: cardBrand || quote.depositStripeCardBrand,
      depositStripeCardLast4: cardLast4 || quote.depositStripeCardLast4,
      stripeAccountKey: stripeAccount.key,
      paymentRecords: [...(quote.paymentRecords || []), paymentRecord],
    })

    const updatedLead = await saveSalesLead({
      ...lead,
      paymentStatus: chargeAmount >= quote.total ? 'paid_in_full' : 'deposit_received',
      depositAmount: chargeAmount,
      depositMethod: 'Credit Card',
      depositDate: now.slice(0, 10),
    })

    await recordQuoteUpdatedAudit(quote, updatedQuote, session?.name)
    await recordLeadPaymentAudit({
      leadId,
      quoteId,
      actorName: session?.name,
      action: 'deposit_charged',
      amount: chargeAmount,
      cardBrand,
      cardLast4,
      note: 'Charged a saved card on file through the CRM.',
    })

    const cardLabel = cardBrand && cardLast4 ? `${cardBrand} ••••${cardLast4}` : 'card on file'
    void sendRepAlertEmail(
      `💳 Deposit charged — ${lead.name} — $${chargeAmount.toFixed(2)} CAD`,
      `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <div style="background:#071421;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">
          Deposit charged — ${lead.name}
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px;font-size:14px;color:#071421">
          <p style="margin:0 0 12px"><strong>Amount charged:</strong> $${chargeAmount.toFixed(2)} CAD</p>
          <p style="margin:0 0 12px"><strong>Card:</strong> ${cardLabel}</p>
          <p style="margin:0 0 12px"><strong>Quote:</strong> ${quote.number}</p>
          <p style="margin:0 0 12px"><strong>Remaining balance:</strong> $${(quote.total - chargeAmount).toFixed(2)} CAD</p>
          <p style="margin:0 0 12px"><strong>Charged by:</strong> ${session?.name || 'CRM'}</p>
          <p style="margin:0"><a href="https://go.quote2move.com/sales/leads/${leadId}" style="color:#071421;font-weight:600">View lead →</a></p>
        </div>
      </div>`
    )

    return NextResponse.json({
      ok: true,
      amount: chargeAmount,
      paymentIntentId: pi.id,
      cardBrand,
      cardLast4,
      lead: updatedLead,
      quote: updatedQuote,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Charge failed' }, { status: stripeErrorStatus(err) })
  }
}
