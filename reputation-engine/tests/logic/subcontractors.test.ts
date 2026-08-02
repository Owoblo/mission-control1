import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSanitizedSubcontractorScope } from '../../lib/subcontractors'
import type { CRMLead, CRMQuote } from '../../lib/types'

test('subcontractor scope exposes cities and operations without customer identity or exact addresses', () => {
  const lead = {
    id: 'lead-1',
    name: 'Private Customer',
    phone: '5195550101',
    email: 'private@example.com',
    originAddress: '123 King Street, London',
    originCity: 'London, ON',
    destAddress: '88 Queen Road, Kitchener',
    destCity: 'Kitchener, ON',
    originAccess: 'Unit 1204, elevator reserved',
    destAccess: 'Walk from 88 Queen Road',
    parkingNotes: 'Park behind 123 King Street',
    inventory: [{ id: 'i1', name: 'Sofa', qty: 1, included: true }],
  } as CRMLead
  const quote = {
    id: 'quote-1', number: 'Q1', clientId: 'c1', status: 'accepted', createdAt: '2026-07-28',
    lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 100, balance: 1030,
    estimatedHours: 5, minimumBillableHours: 4, maximumEstimatedHours: 7,
  } as CRMQuote

  const scope = buildSanitizedSubcontractorScope(lead, quote)
  const serialized = JSON.stringify(scope)

  assert.equal(scope.origin_city, 'London')
  assert.equal(scope.destination_city, 'Kitchener')
  assert.equal(scope.estimated_hours_min, 4)
  assert.equal(scope.estimated_hours_max, 7)
  assert.equal(serialized.includes('Private Customer'), false)
  assert.equal(serialized.includes('private@example.com'), false)
  assert.equal(serialized.includes('123 King'), false)
  assert.equal(serialized.includes('88 Queen'), false)
  assert.equal(serialized.includes('1204'), false)
})
