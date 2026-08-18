import { NextResponse } from 'next/server'
import { BALANCE_AUTHORIZATION_CONSENT_VERSION, getOutstandingBalance } from '@/lib/balance-authorization'
import { buildPaymentRecord } from '@/lib/payment-records'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, stripeErrorStatus } from '@/lib/server/stripe-accounts'
import { fetchStripeCardSummary, formatStripeCardPaymentLabel, stripePost } from '@/lib/server/stripe-payments'
import { sendSalesMessage } from '@/lib/server/sales-messaging'

type StripeIntent = { id?: string; status?: string; amount?: number; amount_capturable?: number; amount_received?: number; canceled_at?: number; latest_charge?: { payment_method_details?: { card?: { capture_before?: number } } }; error?: { message?: string } }

export async function POST(request: Request) {
  const session = await getSessionUser()
  try {
    const body = await request.json() as { leadId?: string; quoteId?: string; action?: 'authorize' | 'increment' | 'capture' | 'cancel'; amount?: number; consentConfirmed?: boolean }
    if (!body.leadId || !body.quoteId || !body.action) return NextResponse.json({ error: 'leadId, quoteId, and action are required.' }, { status: 400 })
    const [lead, quote] = await Promise.all([getSalesLead(body.leadId), getSalesQuote(body.quoteId)])
    if (!lead || !quote || quote.leadId !== lead.id) return NextResponse.json({ error: 'Lead or quote not found.' }, { status: 404 })
    if (!canHandleLeadPayments(session, lead)) return NextResponse.json({ error: 'You do not have permission to manage this authorization.' }, { status: 403 })
    const account = requireStripeAccountForLead(lead); assertQuoteStripeAccount(quote, account.key)
    const paymentMethodId = quote.depositStripePaymentMethodId?.trim(); const customerId = quote.depositStripeCustomerId?.trim()
    const now = new Date().toISOString()
    let updatedQuote = quote

    if (body.action === 'authorize') {
      if (!paymentMethodId) return NextResponse.json({ error: 'No saved card is available. Collect the customer card first.' }, { status: 409 })
      if (!body.consentConfirmed && !quote.balanceAuthorizationConsentAt) return NextResponse.json({ error: 'Confirm the customer authorization consent before placing the hold.' }, { status: 409 })
      const amount = Math.round(Number(body.amount || getOutstandingBalance(quote, lead)) * 100) / 100
      if (amount <= 0) return NextResponse.json({ error: 'There is no outstanding balance to authorize.' }, { status: 409 })
      const params = new URLSearchParams({ amount: String(Math.round(amount * 100)), currency: 'cad', payment_method: paymentMethodId, confirm: 'true', off_session: 'true', capture_method: 'manual', description: `Balance authorization – ${quote.number} – ${lead.name}` })
      if (customerId) params.set('customer', customerId)
      params.set('metadata[quoteId]', quote.id); params.set('metadata[leadId]', lead.id); params.set('metadata[type]', 'balance_authorization'); params.set('expand[]', 'latest_charge'); params.set('payment_method_options[card][request_incremental_authorization]', 'if_available'); appendStripeAccountMetadata(params, account)
      const intent = await stripePost<StripeIntent>('payment_intents', account.secretKey, params)
      if (intent.status !== 'requires_capture' || !intent.id) return NextResponse.json({ error: intent.error?.message || 'The balance authorization was not approved.' }, { status: 402 })
      const card = await fetchStripeCardSummary(account.secretKey, paymentMethodId)
      const captureBefore = intent.latest_charge?.payment_method_details?.card?.capture_before
      updatedQuote = await saveSalesQuote({ ...quote, balanceAuthorizationStatus: 'authorized', balanceAuthorizationAmount: amount, balanceAuthorizationPaymentIntentId: intent.id, balanceAuthorizationAuthorizedAt: now, balanceAuthorizationCaptureBefore: captureBefore ? new Date(captureBefore * 1000).toISOString() : undefined, balanceAuthorizationFailure: undefined, balanceAuthorizationCardBrand: card.cardBrand, balanceAuthorizationCardLast4: card.cardLast4, balanceAuthorizationConsentAt: quote.balanceAuthorizationConsentAt || now, balanceAuthorizationConsentVersion: BALANCE_AUTHORIZATION_CONSENT_VERSION, stripeAccountKey: account.key })
    } else {
      const intentId = quote.balanceAuthorizationPaymentIntentId
      if (!intentId) return NextResponse.json({ error: 'No active balance authorization exists.' }, { status: 409 })
      if (body.action === 'increment') {
        const amount = Math.round(Number(body.amount || getOutstandingBalance(quote, lead)) * 100) / 100
        if (amount <= Number(quote.balanceAuthorizationAmount || 0)) return NextResponse.json({ error: 'The increased authorization must exceed the current hold.' }, { status: 400 })
        const intent = await stripePost<StripeIntent>(`payment_intents/${intentId}/increment_authorization`, account.secretKey, new URLSearchParams({ amount: String(Math.round(amount * 100)) }))
        if (!intent.id) return NextResponse.json({ error: intent.error?.message || 'Additional authorization was declined.' }, { status: 402 })
        updatedQuote = await saveSalesQuote({ ...quote, balanceAuthorizationStatus: 'authorized', balanceAuthorizationAmount: amount, balanceAuthorizationFailure: undefined })
      } else if (body.action === 'cancel') {
        const intent = await stripePost<StripeIntent>(`payment_intents/${intentId}/cancel`, account.secretKey, new URLSearchParams())
        if (!intent.id) return NextResponse.json({ error: intent.error?.message || 'Authorization could not be canceled.' }, { status: 402 })
        updatedQuote = await saveSalesQuote({ ...quote, balanceAuthorizationStatus: 'canceled', balanceAuthorizationCanceledAt: now })
      } else {
        const amount = Math.round(Number(body.amount || getOutstandingBalance(quote, lead)) * 100) / 100
        if (amount <= 0 || amount > Number(quote.balanceAuthorizationAmount || 0)) return NextResponse.json({ error: 'Capture amount must be positive and cannot exceed the authorized amount.' }, { status: 400 })
        const intent = await stripePost<StripeIntent>(`payment_intents/${intentId}/capture`, account.secretKey, new URLSearchParams({ amount_to_capture: String(Math.round(amount * 100)) }))
        if (intent.status !== 'succeeded' || !intent.id) return NextResponse.json({ error: intent.error?.message || 'Final capture failed.' }, { status: 402 })
        const card = await fetchStripeCardSummary(account.secretKey, paymentMethodId)
        const nextBalance = Math.max(0, Math.round((getOutstandingBalance(quote, lead) - amount) * 100) / 100)
        const payment = buildPaymentRecord({ quote, lead, amount, kind: nextBalance <= 0 ? 'final' : 'balance', method: card.cardFunding === 'debit' ? 'debit' : 'credit_card', methodLabel: formatStripeCardPaymentLabel(card.cardBrand, card.cardFunding), cardBrand: card.cardBrand, cardFunding: card.cardFunding, cardLast4: card.cardLast4, paidAt: now, reference: intent.id, recordedBy: session?.name, recordedByUserId: session?.userId })
        updatedQuote = await saveSalesQuote({ ...quote, balance: nextBalance, balancePaidAt: now, balancePaidAmount: Math.round((Number(quote.balancePaidAmount || 0) + amount) * 100) / 100, balancePaidMethod: 'stripe', balanceAuthorizationStatus: 'captured', balanceAuthorizationCapturedAt: now, paymentRecords: [...(quote.paymentRecords || []), payment] })
        await saveSalesLead({ ...lead, paymentStatus: nextBalance <= 0 ? 'paid_in_full' : 'deposit_received' })
      }
    }
    await recordQuoteUpdatedAudit(quote, updatedQuote, session?.name)
    await recordLeadPaymentAudit({ leadId: lead.id, quoteId: quote.id, actorName: session?.name, action: `balance_authorization_${body.action}`, amount: Number(body.amount || updatedQuote.balanceAuthorizationAmount || 0), cardBrand: updatedQuote.balanceAuthorizationCardBrand, cardLast4: updatedQuote.balanceAuthorizationCardLast4, note: `Balance authorization ${body.action} completed.` })
    if (lead.email && (body.action === 'authorize' || body.action === 'capture' || body.action === 'cancel')) {
      const amount = Number(body.amount || updatedQuote.balanceAuthorizationAmount || 0)
      const content = body.action === 'authorize'
        ? { subject: `Temporary balance authorization — ${quote.number}`, body: `Hi ${lead.name.split(' ')[0] || 'there'}, we placed a temporary authorization hold of $${amount.toFixed(2)} CAD on your saved card for the estimated outstanding balance of your move. This is not an additional charge. After service, we will capture only the final approved balance and any unused authorization will be released. Your bank controls when released funds become available.` }
        : body.action === 'capture'
          ? { subject: `Final move balance processed — ${quote.number}`, body: `Hi ${lead.name.split(' ')[0] || 'there'}, we processed the final approved move balance of $${amount.toFixed(2)} CAD. Any unused portion of the earlier authorization has been released; your bank controls when released funds become available.` }
          : { subject: `Balance authorization released — ${quote.number}`, body: `Hi ${lead.name.split(' ')[0] || 'there'}, the temporary balance authorization for your move has been canceled. Your bank controls when the released funds become available.` }
      void sendSalesMessage({ channel: 'email', to: lead.email, subject: content.subject, body: content.body, leadId: lead.id, quoteId: quote.id, actor: 'automation', actorName: 'Saturn Star Moving', notes: `Automatic balance authorization ${body.action} notice` }).catch(() => null)
    }
    return NextResponse.json({ ok: true, quote: updatedQuote, lead: await getSalesLead(lead.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Balance authorization failed.' }, { status: stripeErrorStatus(error) })
  }
}
