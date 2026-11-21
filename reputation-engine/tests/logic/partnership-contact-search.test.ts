import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesPartnershipContactSearch } from '../../lib/partnership-contact-search'

test('contact search finds identity fields regardless of case and surrounding spaces', () => {
  const contact = { name: 'Ahmed Khan', company: 'Example Realty', email: 'ahmed@example.com', city: 'Toronto' }
  for (const query of [' AHMED ', 'example realty', 'ahmed@example.com', 'toronto']) {
    assert.equal(matchesPartnershipContactSearch(contact, query), true)
  }
})

test('an internal email mentioning Ahmed does not match a search for his contact', () => {
  const contact = { name: 'John', company: 'Internal test', latest_inbound_note: 'Open house with Ahmed', latest_touch_note: 'Ahmed replied' }
  assert.equal(matchesPartnershipContactSearch(contact, 'ahmed'), false)
})

test('phone search ignores punctuation without turning mixed text into a phone match', () => {
  const contact = { phone: '+1 (416) 555-0123' }
  assert.equal(matchesPartnershipContactSearch(contact, '4165550123'), true)
  assert.equal(matchesPartnershipContactSearch(contact, '(416) 555 0123'), true)
  assert.equal(matchesPartnershipContactSearch(contact, 'Ahmed 416'), false)
  assert.equal(matchesPartnershipContactSearch(contact, '999999'), false)
  assert.equal(matchesPartnershipContactSearch({}, 'Ahmed'), false)
  assert.equal(matchesPartnershipContactSearch(contact, '  '), true)
})
