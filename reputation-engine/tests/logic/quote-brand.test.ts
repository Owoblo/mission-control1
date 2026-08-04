import assert from 'node:assert/strict'
import test from 'node:test'
import { getCustomerFacingQuoteBranch } from '../../lib/quote-brand'

test('Ottawa route overrides a stale Waterloo branch for customer quote branding', () => {
  assert.equal(getCustomerFacingQuoteBranch({
    branch: 'waterloo',
    originAddress: '65 Woodpark Way, Nepean, ON',
    originCity: 'Nepean',
    destAddress: '319 River Landing Avenue, Nepean, ON',
    destCity: 'Nepean',
  }), 'ottawa')
})

test('saved branch remains the fallback while route is incomplete', () => {
  assert.equal(getCustomerFacingQuoteBranch({ branch: 'waterloo' }), 'waterloo')
})

test('short KW alias does not accidentally match Woodpark', () => {
  assert.equal(getCustomerFacingQuoteBranch({ originAddress: '65 Woodpark Way, Nepean, ON' }), 'ottawa')
})
