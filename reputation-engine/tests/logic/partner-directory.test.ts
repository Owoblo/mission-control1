import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePartnerDirectoryQuery, partnerDirectoryEntryLabel, partnerServiceAreaForCity } from '../../lib/partner-directory'

test('partner directory search normalizes whitespace and limits abusive query length', () => {
  assert.equal(normalizePartnerDirectoryQuery('  Jane   Smith  '), 'Jane Smith')
  assert.equal(normalizePartnerDirectoryQuery('x'.repeat(140)).length, 100)
})

test('partner directory labels retain the contact-company-city graph', () => {
  assert.equal(partnerDirectoryEntryLabel({
    id: 'contact_1',
    name: 'Jane Smith',
    company: 'Example Realty',
    city: 'Kitchener',
  }), 'Jane Smith · Example Realty · Kitchener · Waterloo / KW area')
})

test('municipalities resolve to the operating area without losing their city identity', () => {
  assert.equal(partnerServiceAreaForCity('Amherstburg'), 'Windsor area')
  assert.equal(partnerServiceAreaForCity('London'), 'London area')
  assert.equal(partnerServiceAreaForCity('Unknown Place'), 'Outside core service areas')
})
