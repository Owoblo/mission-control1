import { NextResponse } from 'next/server'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { fetchStripeCardSummary, stripePost } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { sendDepositPaidAlert } from '@/lib/server/internal-notifications'
import { buildPaymentRecord } from '@/lib/payment-records'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, stripeErrorStatus } from '@/lib/server/stripe-accounts'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getReceiptBrand } from '@/lib/receipt-brand'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { buildDepositConfirmationSms } from '@/lib/deposit-confirmation'

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
    let updatedQuote = await saveSalesQuote({
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

    const brand = getReceiptBrand(updatedLead, updatedQuote)
    const receiptUrl = `${getAppBaseUrl('https://go.quote2move.com')}/receipt?id=${encodeURIComponent(updatedQuote.id)}&token=${encodeURIComponent(paymentRecord.publicToken)}`
    const [emailDelivery, smsDelivery] = await Promise.allSettled([
      updatedLead.email
        ? sendDepositReceipt({
            toEmail: updatedLead.email,
            toName: updatedLead.name,
            quoteNumber: updatedQuote.number,
            moveDate: updatedQuote.moveDate,
            originCity: updatedQuote.originCity,
            destCity: updatedQuote.destCity,
            depositAmount: chargeAmount,
            balanceAmount: paymentRecord.balanceAfterPayment,
            totalAmount: updatedQuote.total,
            paymentMethod: paymentRecord.methodLabel,
            receiptNumber: paymentRecord.receiptNumber,
            receiptUrl,
            paidAt: paymentRecord.paidAt,
            reference: paymentRecord.reference,
            brand,
          })
        : Promise.resolve(null),
      updatedLead.phone
        ? sendSalesMessage({
            channel: 'sms',
            to: updatedLead.phone,
            body: buildDepositConfirmationSms({
              customerName: updatedLead.name,
              brandName: brand.name,
              amount: chargeAmount,
              receiptUrl,
            }),
            leadId: updatedLead.id,
            quoteId: updatedQuote.id,
            actor: 'automation',
            actorName: brand.name,
            notes: 'Deposit confirmation and receipt SMS (automatic)',
          })
        : Promise.resolve(null),
    ])
    const deliveredAt = new Date().toISOString()
    const deliveredPayment = {
      ...paymentRecord,
      emailSentAt: updatedLead.email && emailDelivery.status === 'fulfilled' ? deliveredAt : undefined,
      smsSentAt: updatedLead.phone && smsDelivery.status === 'fulfilled' ? deliveredAt : undefined,
    }
    updatedQuote = await saveSalesQuote({
      ...updatedQuote,
      paymentRecords: (updatedQuote.paymentRecords || []).map(item => item.id === paymentRecord.id ? deliveredPayment : item),
    })

    await sendDepositPaidAlert({
      customerName: lead.name,
      amount: chargeAmount,
      quoteNumber: quote.number,
      total: quote.total,
      leadId,
      phone: lead.phone,
      source: 'saved_card',
      chargedBy: session?.name || 'CRM',
      cardLabel: cardBrand && cardLast4 ? `${cardBrand} ••••${cardLast4}` : 'Card on file',
    })

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
