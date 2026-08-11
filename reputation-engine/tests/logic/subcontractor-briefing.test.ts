import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSanitizedPartnerBrief, derivePartnerJobReadiness } from '../../lib/subcontractor-briefing'
import type { CRMLead, CRMQuote } from '../../lib/types'

const lead = { id: 'lead-1', name: 'Private Customer', phone: '2265550100', email: 'private@example.com', stage: 'booked', paymentStatus: 'deposit_received', moveDate: '2026-08-18', originAddress: '1 Secret St', originCity: 'Windsor', destAddress: '2 Private Rd', destCity: 'London', originAccess: 'house', destAccess: 'house', inventory: [{ id: 'i1', name: 'Sectional', qty: 1, included: true }], createdAt: '' } as CRMLead
const quote = { id: 'q1', leadId: 'lead-1', crewSize: 3, truckCount: 1, estimatedHours: 8, status: 'accepted', createdAt: '' } as CRMQuote

test('ready partner jobs require booking, deposit, route, crew, and timing', () => {
  const result = derivePartnerJobReadiness(lead, quote)
  assert.equal(result.ready, true)
  assert.ok(result.suggestedPayout > 0)
})

test('offer briefing removes personal and commercial details', () => {
  const brief = buildSanitizedPartnerBrief(lead, quote)
  assert.doesNotMatch(brief, /Private Customer|2265550100|private@example|Secret St|Private Rd/)
  assert.match(brief, /Windsor.*London/)
  assert.match(brief, /Sectional/)
})
