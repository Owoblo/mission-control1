import { executeDirectPayment } from '@/lib/server/direct-payment-operation'
import { NextResponse } from 'next/server'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { fetchStripeCardSummary, stripePost } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
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
    const { leadId, quoteId, amountOverride, operationId } = (await request.json()) as {
      operationId: string
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

    const result = await executeDirectPayment({
      operationKey: operationId, kind: 'deposit', quote, lead, amount: chargeAmount,
      account: stripeAccount.key, stripeKey, params: piParams, actorName: session?.name, actorId: session?.userId,
    })
    const { pi, cardBrand, cardLast4 } = result
    let updatedQuote = result.quote
    const updatedLead = result.lead
    const paymentRecord = result.paymentRecord
    const nextBalance = updatedQuote.balance
    if (result.replayed) return NextResponse.json({ ok:true, replayed:true, paymentIntentId:pi.id, amount:result.amount, balance:nextBalance, cardBrand, cardLast4, lead:updatedLead, quote:updatedQuote })
    if (!paymentRecord) throw new Error('Payment saved; receipt projection requires reconciliation')

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
