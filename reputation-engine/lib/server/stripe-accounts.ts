import { detectSalesBranchFromLocation } from '../sales'
import { readEnv } from './runtime'
import type { CRMLead, CRMQuote } from '../types'

export type StripeAccountKey = 'saturn' | 'dexa'

export type StripeAccountConfig = {
  key: StripeAccountKey
  brandName: 'Saturn Star Moving' | 'Dexa Movers'
  secretKey: string
  publishableKey: string
  webhookSecret: string
}

export class StripeAccountConfigurationError extends Error {
  status = 503
}

export class StripeAccountMismatchError extends Error {
  status = 409
}

export function resolveStripeAccountKeyForLead(
  lead: Pick<CRMLead, 'branch' | 'originAddress' | 'originCity' | 'destAddress' | 'destCity'>
): StripeAccountKey {
  // Payment ownership follows the branch servicing the pickup. Destination is
  // only a fallback when the pickup market cannot be identified.
  const branch = lead.branch
    || detectSalesBranchFromLocation(lead.originAddress, lead.originCity)
    || detectSalesBranchFromLocation(lead.destAddress, lead.destCity)
  return branch === 'ottawa' ? 'dexa' : 'saturn'
}

export function readStripeAccountConfig(key: StripeAccountKey): StripeAccountConfig {
  if (key === 'dexa') {
    return {
      key,
      brandName: 'Dexa Movers',
      secretKey: readEnv('DEXA_STRIPE_SECRET_KEY'),
      publishableKey: readEnv('DEXA_STRIPE_PUBLISHABLE_KEY'),
      webhookSecret: readEnv('DEXA_STRIPE_WEBHOOK_SECRET'),
    }
  }
  return {
    key,
    brandName: 'Saturn Star Moving',
    secretKey: readEnv('STRIPE_SECRET_KEY'),
    publishableKey: readEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY') || readEnv('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: readEnv('STRIPE_WEBHOOK_SECRET'),
  }
}

export function requireStripeAccountForLead(
  lead: Pick<CRMLead, 'branch' | 'originAddress' | 'originCity' | 'destAddress' | 'destCity'>
) {
  const account = readStripeAccountConfig(resolveStripeAccountKeyForLead(lead))
  if (!account.secretKey) {
    throw new StripeAccountConfigurationError(
      account.key === 'dexa'
        ? 'Dexa Stripe is not configured. Ottawa payments are blocked until Dexa credentials are added.'
        : 'Saturn Star Stripe is not configured.'
    )
  }
  return account
}

export function requireStripeWebhookAccount(key: StripeAccountKey) {
  const account = readStripeAccountConfig(key)
  if (!account.secretKey || !account.webhookSecret) {
    throw new StripeAccountConfigurationError(
      key === 'dexa' ? 'Dexa Stripe webhook is not configured.' : 'Saturn Star Stripe webhook is not configured.'
    )
  }
  return account
}

export function assertQuoteStripeAccount(
  quote: Pick<CRMQuote, 'stripeAccountKey'>,
  expected: StripeAccountKey,
) {
  if (quote.stripeAccountKey && quote.stripeAccountKey !== expected) {
    throw new StripeAccountMismatchError(
      `Payment account mismatch: this quote belongs to ${quote.stripeAccountKey}, not ${expected}.`
    )
  }
}

export function reusableStripeCustomerId(
  quote: Pick<CRMQuote, 'stripeAccountKey' | 'depositStripeCustomerId'> | null | undefined,
  expected: StripeAccountKey,
) {
  if (!quote?.depositStripeCustomerId) return ''
  assertQuoteStripeAccount(quote, expected)
  // Existing unlabelled IDs predate Dexa isolation and therefore belong to
  // Saturn. Never send one to Dexa, where Stripe object IDs are account-local.
  if (!quote.stripeAccountKey && expected === 'dexa') return ''
  return quote.depositStripeCustomerId
}

export function appendStripeAccountMetadata(params: URLSearchParams, account: StripeAccountConfig, prefix = 'metadata') {
  params.set(`${prefix}[stripeAccountKey]`, account.key)
  params.set(`${prefix}[paymentBrand]`, account.brandName)
}

export function webhookMetadataMatchesAccount(metadataAccount: string | null | undefined, expected: StripeAccountKey) {
  if (expected === 'dexa') return metadataAccount === 'dexa'
  // Saturn accepts old events created before account provenance was introduced.
  return !metadataAccount || metadataAccount === 'saturn'
}

export function stripeErrorStatus(error: unknown) {
  if (error instanceof StripeAccountConfigurationError || error instanceof StripeAccountMismatchError) {
    return error.status
  }
  return 500
}
