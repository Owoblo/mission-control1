/**
 * POST /api/sales/stripe/setup-intent
 * Creates a Stripe SetupIntent so we can collect and save card details
 * directly in the CRM without redirecting to Stripe Checkout.
 * Uses raw fetch (no SDK) — same pattern as the checkout route.
 */
import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'
import { listSalesLeads } from '@/lib/server/sales-repository'

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
    const { leadId } = (await request.json()) as { leadId: string }
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

    const leads = await listSalesLeads()
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Create Stripe customer
    const custParams = new URLSearchParams()
    if (lead.name)  custParams.set('name',  lead.name)
    if (lead.email) custParams.set('email', lead.email)
    if (lead.phone) custParams.set('phone', lead.phone)
    custParams.set('metadata[leadId]', leadId)

    const customer = await stripePost('customers', stripeKey, custParams) as { id?: string; error?: { message?: string } }
    if (!customer.id) {
      return NextResponse.json({ error: customer.error?.message || 'Could not create Stripe customer' }, { status: 502 })
    }

    // Create SetupIntent
    const siParams = new URLSearchParams()
    siParams.set('customer', customer.id)
    siParams.set('payment_method_types[0]', 'card')
    siParams.set('usage', 'off_session')
    siParams.set('metadata[leadId]', leadId)

    const si = await stripePost('setup_intents', stripeKey, siParams) as { id?: string; client_secret?: string; error?: { message?: string } }
    if (!si.client_secret) {
      return NextResponse.json({ error: si.error?.message || 'Could not create SetupIntent' }, { status: 502 })
    }

    return NextResponse.json({
      clientSecret: si.client_secret,
      customerId: customer.id,
      setupIntentId: si.id,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setup failed' }, { status: 500 })
  }
}
