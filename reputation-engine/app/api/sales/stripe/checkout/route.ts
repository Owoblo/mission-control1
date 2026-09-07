import { NextResponse } from 'next/server'
import { ensureStripeCustomerForLead } from '@/lib/server/stripe-payments'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { isInvoiceStylePaymentTerms } from '@/lib/sales'
import { appendStripeAccountMetadata, assertQuoteStripeAccount, requireStripeAccountForLead, reusableStripeCustomerId, stripeErrorStatus } from '@/lib/server/stripe-accounts'
import { buildMoveProtectionOffer, type MoveProtectionChoice } from '@/lib/move-protection'

const CURRENT_QUOTE_TERMS_VERSION = '2026-06-07-basic-moving-terms'

export async function POST(request: Request) {
  try {
    const { quoteId, token, successUrl, cancelUrl, termsAccepted, termsVersion, protectionChoice } = (await request.json()) as {
      quoteId: string
      token?: string
      successUrl?: string
      cancelUrl?: string
      termsAccepted?: boolean
      termsVersion?: string
      protectionChoice?: MoveProtectionChoice
    }

    if (!quoteId) return NextResponse.json({ error: 'quoteId is required' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'Quote token is required' }, { status: 401 })
    if (protectionChoice !== 'selected' && protectionChoice !== 'declined') {
      return NextResponse.json({ error: 'Choose Move Protection Plus or continue with standard service.' }, { status: 400 })
    }

    let quote = await getSalesQuote(quoteId)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!quote.acceptToken || token !== quote.acceptToken) {
      return NextResponse.json({ error: 'Quote link is invalid or expired' }, { status: 404 })
    }

    if (!quote.termsAcceptedAt && termsAccepted !== true) {
      return NextResponse.json({ error: 'Terms must be accepted before paying the deposit.' }, { status: 400 })
    }

    // Auto-accept any quote in sent/viewed status when customer initiates checkout
    if (quote.status === 'sent' || quote.status === 'viewed') {
      const { saveSalesQuote: saveQ } = await import('@/lib/server/sales-repository')
      const headers = request.headers
      quote = await saveQ({
        ...quote,
        status: 'accepted',
        acceptedAt: new Date().toISOString().slice(0, 10),
        respondedAt: new Date().toISOString(),
        termsAcceptedAt: quote.termsAcceptedAt || new Date().toISOString(),
        termsAcceptedVersion: quote.termsAcceptedVersion || termsVersion || CURRENT_QUOTE_TERMS_VERSION,
        termsAcceptedIp: quote.termsAcceptedIp || headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || undefined,
        termsAcceptedUserAgent: quote.termsAcceptedUserAgent || headers.get('user-agent') || undefined,
      })
    }

    if (quote.status === 'accepted' && !quote.termsAcceptedAt && termsAccepted === true) {
      const { saveSalesQuote: saveQ } = await import('@/lib/server/sales-repository')
      const headers = request.headers
      quote = await saveQ({
        ...quote,
        termsAcceptedAt: new Date().toISOString(),
        termsAcceptedVersion: termsVersion || CURRENT_QUOTE_TERMS_VERSION,
        termsAcceptedIp: headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || undefined,
        termsAcceptedUserAgent: headers.get('user-agent') || undefined,
      })
    }

    if (quote.status !== 'accepted') {
      return NextResponse.json({ error: 'Quote must be accepted before paying deposit' }, { status: 400 })
    }

    if (isInvoiceStylePaymentTerms(quote.paymentTerms) || Number(quote.deposit || 0) <= 0) {
      return NextResponse.json({ error: 'This quote is set for approval/invoice billing and does not require an online deposit.' }, { status: 400 })
    }

    // Find the linked lead for customer info + leadId in metadata
    const lead = quote.leadId ? await getSalesLead(quote.leadId).catch(() => null) : null
    if (!lead) return NextResponse.json({ error: 'Quote lead not found' }, { status: 404 })
    const depositAlreadyPaid = Boolean(
      quote.depositPaidAt ||
      quote.depositStripePaymentIntentId ||
      Number(quote.depositPaidAmount || 0) > 0 ||
      lead.paymentStatus === 'deposit_received' ||
      lead.paymentStatus === 'paid_in_full'
    )
    if (depositAlreadyPaid) {
      return NextResponse.json({
        error: 'The deposit for this move has already been received.',
        code: 'deposit_already_paid',
        paidAt: quote.depositPaidAt || lead.depositDate,
        amount: Number(quote.depositPaidAmount || lead.depositAmount || 0),
      }, { status: 409 })
    }
    const stripeAccount = requireStripeAccountForLead(lead)
    assertQuoteStripeAccount(quote, stripeAccount.key)
    const stripeKey = stripeAccount.secretKey
    const protection = buildMoveProtectionOffer()
    const now = new Date().toISOString()
    const { saveSalesQuote: saveQ } = await import('@/lib/server/sales-repository')
    quote = await saveQ({
      ...quote,
      protectionOffer: {
        productCode: protection.productCode,
        version: protection.version,
        name: protection.name,
        price: protection.price,
        currency: protection.currency,
        decision: protectionChoice,
        decidedAt: now,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      },
    })

    const appUrl = getAppBaseUrl('https://mission-control1-reputation-engine.vercel.app')
    const returnBase = `${appUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken || '')}`
    const safeRedirectUrl = (value: string | undefined, fallback: string) => {
      if (!value) return fallback
      try {
        const parsed = new URL(value)
        return parsed.origin === appUrl ? parsed.toString() : fallback
      } catch {
        return fallback
      }
    }

    // Build Stripe checkout session via REST API (no SDK needed)
    const params = new URLSearchParams()
    params.set('mode', 'payment')
    params.set('payment_method_types[0]', 'card')

    // Save the card on file for balance charge after job
    params.set('payment_intent_data[setup_future_usage]', 'off_session')
    params.set('payment_intent_data[description]', `Deposit – ${quote.number} – ${lead?.name || 'Customer'}`)
    params.set('payment_intent_data[metadata][quoteId]', quote.id)
    params.set('payment_intent_data[metadata][quoteNumber]', quote.number)
    if (lead?.id) params.set('payment_intent_data[metadata][leadId]', lead.id)
    params.set('payment_intent_data[metadata][protectionChoice]', protectionChoice)
    params.set('payment_intent_data[metadata][protectionVersion]', protection.version)
    appendStripeAccountMetadata(params, stripeAccount, 'payment_intent_data[metadata]')

    if (lead) {
      const { customerId } = await ensureStripeCustomerForLead(stripeKey, lead, reusableStripeCustomerId(quote, stripeAccount.key), stripeAccount)
      if (customerId) {
        params.set('customer', customerId)
      }
    }

    params.set('line_items[0][price_data][currency]', 'cad')
    params.set('line_items[0][price_data][product_data][name]', `${stripeAccount.brandName} — ${quote.number} Deposit`)
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Booking deposit (${quote.originCity || 'Origin'} → ${quote.destCity || 'Destination'}). Card saved on file for balance after move.`
    )
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(quote.deposit * 100)))
    params.set('line_items[0][quantity]', '1')

    if (protectionChoice === 'selected') {
      params.set('line_items[1][price_data][currency]', 'cad')
      params.set('line_items[1][price_data][product_data][name]', protection.name)
      params.set('line_items[1][price_data][product_data][description]', 'Optional enhanced moving service. Not an insurance policy. Includes selected-item condition records, enhanced wrapping, crew handling notes, and priority damage-intake support.')
      params.set('line_items[1][price_data][product_data][metadata][productCode]', protection.productCode)
      params.set('line_items[1][price_data][product_data][metadata][version]', protection.version)
      params.set('line_items[1][price_data][unit_amount]', String(Math.round(protection.price * 100)))
      params.set('line_items[1][quantity]', '1')
    }

    // Metadata on session for webhook
    params.set('metadata[quoteId]', quote.id)
    params.set('metadata[quoteNumber]', quote.number)
    if (lead?.id) params.set('metadata[leadId]', lead.id)
    params.set('metadata[protectionChoice]', protectionChoice)
    params.set('metadata[protectionVersion]', protection.version)
    params.set('metadata[protectionPrice]', protectionChoice === 'selected' ? String(protection.price) : '0')
    appendStripeAccountMetadata(params, stripeAccount)

    params.set('success_url', safeRedirectUrl(successUrl, `${returnBase}&paid=1${protectionChoice === 'selected' ? '&protection=1' : ''}`))
    params.set('cancel_url', safeRedirectUrl(cancelUrl, returnBase))

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await stripeResponse.json() as {
      id?: string
      url?: string
      error?: { message?: string }
    }

    if (!stripeResponse.ok || !session.url) {
      return NextResponse.json({ error: session.error?.message || 'Stripe session creation failed' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url, sessionId: session.id, stripeAccountKey: stripeAccount.key })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: stripeErrorStatus(err) })
  }
}
