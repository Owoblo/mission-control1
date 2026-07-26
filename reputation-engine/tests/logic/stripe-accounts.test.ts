import assert from 'node:assert/strict'
import {
  assertQuoteStripeAccount,
  resolveStripeAccountKeyForLead,
  reusableStripeCustomerId,
  webhookMetadataMatchesAccount,
} from '../../lib/server/stripe-accounts'

assert.equal(resolveStripeAccountKeyForLead({ branch: 'ottawa' }), 'dexa')
assert.equal(resolveStripeAccountKeyForLead({ branch: 'waterloo' }), 'saturn')
assert.equal(resolveStripeAccountKeyForLead({ originCity: 'Kanata' }), 'dexa')
assert.equal(resolveStripeAccountKeyForLead({ originCity: 'London' }), 'saturn')
assert.equal(resolveStripeAccountKeyForLead({ originCity: 'Windsor', destCity: 'Ottawa' }), 'saturn')
assert.equal(resolveStripeAccountKeyForLead({ originCity: 'Ottawa', destCity: 'Windsor' }), 'dexa')
assert.equal(resolveStripeAccountKeyForLead({ destCity: 'Ottawa' }), 'dexa')
assert.equal(
  resolveStripeAccountKeyForLead({ branch: 'windsor', originCity: 'Ottawa', destCity: 'Windsor' }),
  'saturn'
)

assert.throws(
  () => assertQuoteStripeAccount({ stripeAccountKey: 'saturn' }, 'dexa'),
  /Payment account mismatch/
)
assert.equal(
  reusableStripeCustomerId({ stripeAccountKey: 'saturn', depositStripeCustomerId: 'cus_saturn' }, 'saturn'),
  'cus_saturn'
)
assert.equal(
  reusableStripeCustomerId({ depositStripeCustomerId: 'cus_legacy_saturn' }, 'dexa'),
  ''
)
assert.equal(webhookMetadataMatchesAccount(undefined, 'saturn'), true)
assert.equal(webhookMetadataMatchesAccount(undefined, 'dexa'), false)
assert.equal(webhookMetadataMatchesAccount('dexa', 'saturn'), false)
assert.equal(webhookMetadataMatchesAccount('dexa', 'dexa'), true)
