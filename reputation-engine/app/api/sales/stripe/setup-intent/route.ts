/**
 * POST /api/sales/stripe/setup-intent
 * Creates a Stripe SetupIntent so we can collect and save card details
 * directly in the CRM without redirecting to Stripe Checkout.
 * Returns a client_secret for use with Stripe Elements on the frontend.
 */
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { hasInternalSession } from '@/lib/server/session'
import { listSalesLeads } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  try {
    const { leadId } = (await request.json()) as { leadId: string }
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

    const leads = await listSalesLeads()
    const lead = leads.find(l => l.id === leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' })

    // Create or reuse Stripe customer for this lead
    let customerId: string | undefined
    const existing = await stripe.customers.search({
      query: `email:"${lead.email || ''}" AND metadata["leadId"]:"${leadId}"`,
      limit: 1,
    }).catch(() => ({ data: [] }))

    if (existing.data.length > 0) {
      customerId = existing.data[0].id
    } else {
      const customer = await stripe.customers.create({
        name: lead.name || undefined,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        metadata: { leadId },
      })
      customerId = customer.id
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { leadId },
    })

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId,
      setupIntentId: setupIntent.id,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Setup failed' }, { status: 500 })
  }
}
