import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRecentSaleEventKey,
  buildRecentSaleListingUrl,
  buildRecentSaleMessage,
  classifyRecentSaleRelationship,
  RECENT_SALE_MESSAGE_TEMPLATE,
  scoreRecentSaleContact,
} from '../../lib/recent-sale-opportunity'

test('matches a Realtor most strongly by exact phone and name', () => {
  const result = scoreRecentSaleContact(
    { name: 'Trudy Enns, Realtor', phone: '(519) 555-1212', brokerage: 'Example Realty Brokerage' },
    { id: '1', name: 'Trudy Enns', phone: '+1 519-555-1212', company: 'Example Realty' }
  )
  assert.equal(result.score, 190)
  assert.deepEqual(result.reasons, ['phone', 'name', 'brokerage'])
})

test('event keys deduplicate the same MLS and Realtor', () => {
  assert.equal(
    buildRecentSaleEventKey({ mls: 'X123', address: '10 Main St', realtorName: 'Trudy Enns' }),
    buildRecentSaleEventKey({ mls: 'X123', address: 'Different Address', realtorName: 'TRUDY ENNS, REALTOR' })
  )
})

test('recent-sale drafts use the approved relationship template', () => {
  const relationship = classifyRecentSaleRelationship({
    id: '1',
    name: 'Trudy Enns',
    stage: 'partnership_active',
  })
  const message = buildRecentSaleMessage({
    realtorName: 'Trudy Enns',
    address: '10 Main Street, Windsor',
    city: 'Windsor',
    relationship,
  })
  assert.equal(relationship, 'active_partner')
  assert.equal(
    message,
    `Hi Trudy, congratulations on the sale of 10 Main Street.

I wanted to reach out in case your client still needs help with their move. We’d be happy to provide them with a straightforward estimate and make the process as easy as possible.

No pressure at all, but would you be comfortable passing along our number to them?`
  )
  assert.match(RECENT_SALE_MESSAGE_TEMPLATE, /\{\{name\}\}/)
  assert.match(RECENT_SALE_MESSAGE_TEMPLATE, /\{\{address\}\}/)
})

test('recent-sale listing links prefer the stored source and fall back to a targeted search', () => {
  assert.equal(
    buildRecentSaleListingUrl({
      address: '37 Kintail Cres, London, ON',
      city: 'London',
      metadata: { ListingURL: 'https://www.zillow.com/homedetails/example/' },
    }),
    'https://www.zillow.com/homedetails/example/'
  )
  assert.match(
    buildRecentSaleListingUrl({ address: '10 Main Street, Windsor', city: 'Windsor' }),
    /google\.com\/search/
  )
})
