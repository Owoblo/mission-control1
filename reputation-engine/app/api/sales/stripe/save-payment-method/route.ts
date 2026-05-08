/**
 * POST /api/sales/stripe/save-payment-method
 * After client-side Stripe Elements confirmation, saves the payment method
 * and optionally charges the deposit. Uses raw fetch (no SDK).
 */
import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { getSalesQuote, listSalesLeads, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'

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

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const stripeKey = readEnv('STRIPE_SECRET_KEY')
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  try {
    const { leadId, quoteId, setupIntentId, customerId, chargeDepositNow } = (await request.json()) as {
      leadId: string
      quoteId?: string
      setupIntentId: string
      customerId: string
      chargeDepositNow?: boolean
    }

    // Verify SetupIntent succeeded and get payment method
    const si = await stripeGet(`setup_intents/${setupIntentId}`, stripeKey) as {
      status?: string
      payment_method?: string
      error?: { message?: string }
    }
    if (si.status !== 'succeeded') {
      return NextResponse.json({ error: `Card not confirmed — status: ${si.status}` }, { status: 400 })
    }

    const paymentMethodId = si.payment_method
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'No payment method on setup intent' }, { status: 400 })
    }

    // Get card details (brand + last4)
    const pm = await stripeGet(`payment_methods/${paymentMethodId}`, stripeKey) as {
      card?: { brand?: string; last4?: string }
    }
    const cardBrand = pm.card?.brand || 'card'
    const cardLast4 = pm.card?.last4 || '????'

    const leads = await listSalesLeads()
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    let depositCharged = false
    let depositAmount = 0

    if (chargeDepositNow && quoteId) {
      const quote = await getSalesQuote(quoteId)
      if (quote && quote.deposit > 0) {
        const piParams = new URLSearchParams()
        piParams.set('amount', String(Math.round(quote.deposit * 100)))
        piParams.set('currency', 'cad')
        piParams.set('customer', customerId)
        piParams.set('payment_method', paymentMethodId)
        piParams.set('confirm', 'true')
        piParams.set('off_session', 'true')
        piParams.set('description', `Deposit – ${quote.number} – ${lead.name}`)
        piParams.set('metadata[quoteId]', quote.id)
        piParams.set('metadata[leadId]', leadId)
        piParams.set('metadata[type]', 'deposit')

        const pi = await stripePost('payment_intents', stripeKey, piParams) as {
          id?: string; status?: string; error?: { message?: string }
        }

        if (pi.status === 'succeeded' && pi.id) {
          depositCharged = true
          depositAmount = quote.deposit
          const now = new Date().toISOString()
          await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripePaymentIntentId: pi.id,
            depositStripeCustomerId: customerId,
            depositStripePaymentMethodId: paymentMethodId,
          })
        } else if (pi.error?.message) {
          return NextResponse.json({ error: pi.error.message }, { status: 402 })
        }
      }
    } else if (quoteId) {
      const quote = await getSalesQuote(quoteId)
      if (quote) {
        await saveSalesQuote({
          ...quote,
          depositStripeCustomerId: customerId,
          depositStripePaymentMethodId: paymentMethodId,
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

    return NextResponse.json({
      ok: true,
      depositCharged,
      depositAmount,
      cardBrand,
      cardLast4,
      paymentMethodId,
      customerId,
      lead: updatedLead,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
  }
}
