import type { CRMLead } from '@/lib/types'

export type StripeCardFunding = 'credit' | 'debit' | 'prepaid' | 'unknown'

type StripeErrorPayload = {
  error?: {
    message?: string
  }
}

export async function stripeGet<T extends Record<string, unknown>>(path: string, key: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  return res.json() as Promise<T>
}

export async function stripePost<T extends Record<string, unknown>>(path: string, key: string, body: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    cache: 'no-store',
  })
  return res.json() as Promise<T>
}

export async function ensureStripeCustomerForLead(
  stripeKey: string,
  lead: CRMLead,
  preferredCustomerId?: string | null,
  account?: { key: 'saturn' | 'dexa'; brandName: string },
) {
  const trimmedPreferred = (preferredCustomerId || '').trim()
  if (trimmedPreferred) {
    return { customerId: trimmedPreferred, reused: true as const }
  }

  let customerId = ''

  if (lead.email) {
    const searchRes = await fetch(
      `https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:"${lead.email}"`)}`,
      { headers: { Authorization: `Bearer ${stripeKey}` }, cache: 'no-store' }
    )
    const searchData = await searchRes.json() as { data?: Array<{ id: string }> }
    customerId = searchData.data?.[0]?.id || ''
  }

  if (!customerId) {
    const customerParams = new URLSearchParams()
    if (lead.name) customerParams.set('name', lead.name)
    if (lead.email) customerParams.set('email', lead.email)
    if (lead.phone) customerParams.set('phone', lead.phone)
    customerParams.set('metadata[leadId]', lead.id)
    if (account) {
      customerParams.set('metadata[stripeAccountKey]', account.key)
      customerParams.set('metadata[paymentBrand]', account.brandName)
    }

    const customer = await stripePost<{ id?: string } & StripeErrorPayload>('customers', stripeKey, customerParams)
    if (!customer.id) {
      throw new Error(customer.error?.message || 'Could not create Stripe customer')
    }
    customerId = customer.id
  }

  return { customerId, reused: false as const }
}

export async function fetchStripeCardSummary(stripeKey: string, paymentMethodId?: string | null) {
  const trimmed = (paymentMethodId || '').trim()
  if (!trimmed) {
    return { cardBrand: '', cardLast4: '', cardFunding: 'unknown' as StripeCardFunding }
  }

  const paymentMethod = await stripeGet<{ card?: { brand?: string; last4?: string; funding?: string } }>(
    `payment_methods/${trimmed}`,
    stripeKey
  )

  return {
    cardBrand: paymentMethod.card?.brand || '',
    cardLast4: paymentMethod.card?.last4 || '',
    cardFunding: normalizeStripeCardFunding(paymentMethod.card?.funding),
  }
}

export function normalizeStripeCardFunding(value?: string | null): StripeCardFunding {
  return value === 'credit' || value === 'debit' || value === 'prepaid' ? value : 'unknown'
}

export function formatStripeCardPaymentLabel(cardBrand?: string | null, funding?: StripeCardFunding | null) {
  const brand = (cardBrand || '').trim().toLowerCase()
  const brandLabel = brand === 'amex' ? 'American Express' : brand === 'mastercard' ? 'Mastercard' : brand === 'visa' ? 'Visa' : brand ? `${brand.charAt(0).toUpperCase()}${brand.slice(1)}` : 'Card'
  const fundingLabel = funding === 'debit' ? 'Debit' : funding === 'prepaid' ? 'Prepaid' : funding === 'credit' ? 'Credit' : 'Card'
  return `${brandLabel} ${fundingLabel}`.replace(/^Card Card$/, 'Card')
}

export function requiresCardFundingReview(funding?: StripeCardFunding | null) {
  return funding === 'debit' || funding === 'prepaid'
}

export function formatStoredCardLabel(cardBrand?: string | null, cardLast4?: string | null) {
  const brand = (cardBrand || '').trim()
  const last4 = (cardLast4 || '').trim()
  if (brand && last4) return `${brand.toUpperCase()} ending ${last4}`
  if (last4) return `Card ending ${last4}`
  if (brand) return `${brand.toUpperCase()} card`
  return 'card on file'
}
