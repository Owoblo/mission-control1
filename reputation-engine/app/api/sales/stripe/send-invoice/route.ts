import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { getSalesQuote, listSalesLeads, saveSalesQuote } from '@/lib/server/sales-repository'

async function stripeGet(path: string, key: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.json() as Promise<Record<string, unknown>>
}

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

function appendInternalNote(existing: string | undefined, nextLine: string) {
  const trimmed = (existing || '').trim()
  if (!trimmed) return nextLine
  if (trimmed.includes(nextLine)) return trimmed
  return `${trimmed}\n${nextLine}`
}

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const stripeKey = readEnv('STRIPE_SECRET_KEY')
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

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

    const [quote, leads] = await Promise.all([getSalesQuote(quoteId), listSalesLeads()])
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const lead = leads.find(item => item.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!lead.email) {
      return NextResponse.json({ error: 'Customer email is required before sending an invoice.' }, { status: 400 })
    }

    const amount = Math.round(Number(amountOverride ?? quote.balance) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invoice amount must be greater than zero.' }, { status: 400 })
    }

    const note = (description || '').trim() || `Remaining balance - ${quote.number} - ${lead.name}`

    let customerId = String(quote.depositStripeCustomerId || '')
    if (!customerId) {
      const searchRes = await fetch(
        `https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:"${lead.email}"`)}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      )
      const searchData = await searchRes.json() as { data?: Array<{ id: string }> }
      customerId = searchData.data?.[0]?.id || ''
    }

    if (!customerId) {
      const customerParams = new URLSearchParams()
      customerParams.set('name', lead.name)
      customerParams.set('email', lead.email)
      if (lead.phone) customerParams.set('phone', lead.phone)
      customerParams.set('metadata[leadId]', lead.id)
      const customer = await stripePost('customers', stripeKey, customerParams) as { id?: string; error?: { message?: string } }
      if (!customer.id) {
        return NextResponse.json({ error: customer.error?.message || 'Could not create Stripe customer.' }, { status: 502 })
      }
      customerId = customer.id
    }

    const itemParams = new URLSearchParams()
    itemParams.set('customer', customerId)
    itemParams.set('amount', String(Math.round(amount * 100)))
    itemParams.set('currency', 'cad')
    itemParams.set('description', note)
    itemParams.set('metadata[leadId]', lead.id)
    itemParams.set('metadata[quoteId]', quote.id)
    itemParams.set('metadata[quoteNumber]', quote.number)
    itemParams.set('metadata[type]', 'manual_invoice')
    const invoiceItem = await stripePost('invoiceitems', stripeKey, itemParams) as { id?: string; error?: { message?: string } }
    if (!invoiceItem.id) {
      return NextResponse.json({ error: invoiceItem.error?.message || 'Could not create invoice item.' }, { status: 502 })
    }

    const invoiceParams = new URLSearchParams()
    invoiceParams.set('customer', customerId)
    invoiceParams.set('collection_method', 'send_invoice')
    invoiceParams.set('days_until_due', String(Math.max(0, Number(dueDays || 0))))
    invoiceParams.set('description', `Saturn Star Moving - ${quote.number}`)
    invoiceParams.set('metadata[leadId]', lead.id)
    invoiceParams.set('metadata[quoteId]', quote.id)
    invoiceParams.set('metadata[quoteNumber]', quote.number)
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
      internalNotes: appendInternalNote(
        quote.internalNotes,
        `Manual Stripe invoice sent on ${timestamp.slice(0, 10)} for $${amount.toFixed(2)}.`
      ),
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
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invoice send failed' }, { status: 500 })
  }
}
