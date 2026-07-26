/**
 * POST /api/sales/stripe/record-cash
 * Records a cash, cheque, or e-transfer deposit in Stripe as an out-of-band
 * payment on a finalized invoice. The money never touches Stripe — this is
 * purely for accounting/revenue tracking so the books stay clean.
 */
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead } from '@/lib/server/sales-repository'
import { canHandleLeadPayments } from '@/lib/server/sales-permissions'
import { appendStripeAccountMetadata, requireStripeAccountForLead, stripeErrorStatus } from '@/lib/server/stripe-accounts'

async function stripePost(path: string, key: string, body: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  return res.json() as Promise<Record<string, unknown>>
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return new Response('Unauthorized', { status: 401 })

  try {
    const {
      leadId, leadName, leadEmail, leadPhone,
      quoteNumber, amount, method, description,
    } = (await request.json()) as {
      leadId: string
      leadName: string
      leadEmail?: string
      leadPhone?: string
      quoteNumber: string
      amount: number          // dollars
      method: 'cash' | 'etransfer' | 'cheque'
      description?: string
    }

    const lead = await getSalesLead(leadId)
    if (!lead || !canHandleLeadPayments(session, lead)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const stripeAccount = requireStripeAccountForLead(lead)
    const stripeKey = stripeAccount.secretKey

    const methodLabel = { cash: 'Cash', etransfer: 'Interac E-Transfer', cheque: 'Cheque' }[method]

    // 1 — Find or create Stripe customer
    let customerId: string
    if (leadEmail) {
      const searchRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:"${leadEmail}"`)}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      )
      const searchData = await searchRes.json() as { data?: Array<{ id: string }> }
      if (searchData.data && searchData.data.length > 0) {
        customerId = searchData.data[0].id
      } else {
        const custParams = new URLSearchParams()
        custParams.set('name', leadName)
        if (leadEmail) custParams.set('email', leadEmail)
        if (leadPhone) custParams.set('phone', leadPhone)
        custParams.set('metadata[leadId]', leadId)
        appendStripeAccountMetadata(custParams, stripeAccount)
        const cust = await stripePost('customers', stripeKey, custParams) as { id?: string }
        customerId = cust.id!
      }
    } else {
      const custParams = new URLSearchParams()
      custParams.set('name', leadName)
      if (leadPhone) custParams.set('phone', leadPhone)
      custParams.set('metadata[leadId]', leadId)
      appendStripeAccountMetadata(custParams, stripeAccount)
      const cust = await stripePost('customers', stripeKey, custParams) as { id?: string }
      customerId = cust.id!
    }

    // 2 — Create invoice item
    const itemParams = new URLSearchParams()
    itemParams.set('customer', customerId)
    itemParams.set('amount', String(Math.round(amount * 100)))
    itemParams.set('currency', 'cad')
    itemParams.set('description', description || `Deposit – Quote ${quoteNumber} – ${methodLabel}`)
    itemParams.set('metadata[leadId]', leadId)
    itemParams.set('metadata[quoteNumber]', quoteNumber)
    itemParams.set('metadata[method]', method)
    appendStripeAccountMetadata(itemParams, stripeAccount)
    await stripePost('invoiceitems', stripeKey, itemParams)

    // 3 — Create invoice
    const invParams = new URLSearchParams()
    invParams.set('customer', customerId)
    invParams.set('collection_method', 'send_invoice')
    invParams.set('days_until_due', '0')
    invParams.set('description', `${stripeAccount.brandName} — Quote ${quoteNumber}`)
    invParams.set('metadata[leadId]', leadId)
    invParams.set('metadata[quoteNumber]', quoteNumber)
    invParams.set('metadata[paymentMethod]', methodLabel)
    appendStripeAccountMetadata(invParams, stripeAccount)
    const inv = await stripePost('invoices', stripeKey, invParams) as { id?: string; error?: { message?: string } }
    if (!inv.id) return NextResponse.json({ error: inv.error?.message || 'Invoice creation failed' }, { status: 502 })

    // 4 — Finalize invoice
    await stripePost(`invoices/${inv.id}/finalize`, stripeKey, new URLSearchParams())

    // 5 — Mark paid out of band (records revenue without charging)
    const payParams = new URLSearchParams()
    payParams.set('paid_out_of_band', 'true')
    const paid = await stripePost(`invoices/${inv.id}/pay`, stripeKey, payParams) as {
      id?: string; status?: string; error?: { message?: string }
    }

    if (paid.status !== 'paid') {
      return NextResponse.json({ error: paid.error?.message || 'Could not mark invoice paid' }, { status: 502 })
    }

    return NextResponse.json({ ok: true, invoiceId: inv.id, customerId, method: methodLabel, stripeAccountKey: stripeAccount.key })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Record failed' }, { status: stripeErrorStatus(err) })
  }
}
