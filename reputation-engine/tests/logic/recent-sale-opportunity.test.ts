import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRecentSaleEventKey,
  buildRecentSaleMessage,
  classifyRecentSaleRelationship,
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

test('active partners receive the warmer relationship message', () => {
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
  assert.match(message, /10 Main Street/)
  assert.match(message, /always happy/)
})
