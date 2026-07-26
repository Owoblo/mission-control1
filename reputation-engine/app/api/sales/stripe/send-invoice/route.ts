import { NextResponse } from 'next/server'
import { recordLeadPaymentAudit, recordQuoteUpdatedAudit } from '@/lib/server/sales-audit'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { ensureStripeCustomerForLead, stripeGet, stripePost } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, reusableStripeCustomerId, stripeErrorStatus } from '@/lib/server/stripe-accounts'

function appendInternalNote(existing: string | undefined, nextLine: string) {
  const trimmed = (existing || '').trim()
  if (!trimmed) return nextLine
  if (trimmed.includes(nextLine)) return trimmed
  return `${trimmed}\n${nextLine}`
}

export async function POST(request: Request) {
  const session = await getSessionUser()

  try {
    const { leadId, quoteId, amountOverride, description, dueDays } = (await request.json()) as {
      leadId: string
      quoteId: string
      amountOverride?: number
      description?: string
      dueDays?: number
    }

    if (!leadId || !quoteId) {
      return NextResponse.json({ error: 'leadId and quoteId are required' }, { status: 400 })
    }

    const [quote, lead] = await Promise.all([getSalesQuote(quoteId), getSalesLead(leadId)])
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (quote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote does not belong to this lead.' }, { status: 400 })
    }
    if (!canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'You do not have permission to send payment requests for this lead.' }, { status: 403 })
    }
    if (!lead.email) {
      return NextResponse.json({ error: 'Customer email is required before sending an invoice.' }, { status: 400 })
    }
    const stripeAccount = requireStripeAccountForLead(lead)
    assertQuoteStripeAccount(quote, stripeAccount.key)
    const stripeKey = stripeAccount.secretKey

    const amount = Math.round(Number(amountOverride ?? quote.balance) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invoice amount must be greater than zero.' }, { status: 400 })
    }

    const note = (description || '').trim() || `Remaining balance - ${quote.number} - ${lead.name}`

    const { customerId } = await ensureStripeCustomerForLead(stripeKey, lead, reusableStripeCustomerId(quote, stripeAccount.key), stripeAccount)

    const itemParams = new URLSearchParams()
    itemParams.set('customer', customerId)
    itemParams.set('amount', String(Math.round(amount * 100)))
    itemParams.set('currency', 'cad')
    itemParams.set('description', note)
    itemParams.set('metadata[leadId]', lead.id)
    itemParams.set('metadata[quoteId]', quote.id)
    itemParams.set('metadata[quoteNumber]', quote.number)
    itemParams.set('metadata[type]', 'manual_invoice')
    appendStripeAccountMetadata(itemParams, stripeAccount)
    const invoiceItem = await stripePost('invoiceitems', stripeKey, itemParams) as { id?: string; error?: { message?: string } }
    if (!invoiceItem.id) {
      return NextResponse.json({ error: invoiceItem.error?.message || 'Could not create invoice item.' }, { status: 502 })
    }

    const invoiceParams = new URLSearchParams()
    invoiceParams.set('customer', customerId)
    invoiceParams.set('collection_method', 'send_invoice')
    invoiceParams.set('days_until_due', String(Math.max(0, Number(dueDays || 0))))
    invoiceParams.set('description', `${stripeAccount.brandName} - ${quote.number}`)
    invoiceParams.set('metadata[leadId]', lead.id)
    invoiceParams.set('metadata[quoteId]', quote.id)
    invoiceParams.set('metadata[quoteNumber]', quote.number)
    appendStripeAccountMetadata(invoiceParams, stripeAccount)
    const invoice = await stripePost('invoices', stripeKey, invoiceParams) as { id?: string; error?: { message?: string } }
    if (!invoice.id) {
      return NextResponse.json({ error: invoice.error?.message || 'Could not create invoice.' }, { status: 502 })
    }

    const finalized = await stripePost(`invoices/${invoice.id}/finalize`, stripeKey, new URLSearchParams()) as {
      id?: string
      error?: { message?: string }
    }
    if (!finalized.id) {
      return NextResponse.json({ error: finalized.error?.message || 'Could not finalize invoice.' }, { status: 502 })
    }

    const sent = await stripePost(`invoices/${invoice.id}/send`, stripeKey, new URLSearchParams()) as {
      id?: string
      hosted_invoice_url?: string
      status?: string
      error?: { message?: string }
    }
    if (!sent.id) {
      return NextResponse.json({ error: sent.error?.message || 'Could not send invoice.' }, { status: 502 })
    }

    const refreshedInvoice = await stripeGet(`invoices/${invoice.id}`, stripeKey) as {
      hosted_invoice_url?: string
      status?: string
    }

    const timestamp = new Date().toISOString()
    const savedQuote = await saveSalesQuote({
      ...quote,
      balance: amount,
      status: 'invoiced',
      depositStripeCustomerId: customerId,
      stripeAccountKey: stripeAccount.key,
      internalNotes: appendInternalNote(
        quote.internalNotes,
        `Manual Stripe invoice sent on ${timestamp.slice(0, 10)} for $${amount.toFixed(2)}.`
      ),
    })

    await recordQuoteUpdatedAudit(quote, savedQuote, session?.name)
    await recordLeadPaymentAudit({
      leadId,
      quoteId,
      actorName: session?.name,
      action: 'invoice_sent',
      amount,
      note: `Hosted invoice ready${refreshedInvoice.hosted_invoice_url || sent.hosted_invoice_url ? ' for customer payment.' : '.'}`,
    })

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      hostedInvoiceUrl: String(refreshedInvoice.hosted_invoice_url || sent.hosted_invoice_url || ''),
      status: refreshedInvoice.status || sent.status || 'open',
      amount,
      quote: savedQuote,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invoice send failed' }, { status: stripeErrorStatus(err) })
  }
}
