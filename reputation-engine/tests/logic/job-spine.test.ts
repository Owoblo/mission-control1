import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveJobReadiness, deriveOperatingExceptions, deriveOperatingStage } from '../../lib/job-spine'
import type { CRMLead, CRMQuote } from '../../lib/types'

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return { id: 'lead-1', name: 'Alex Morgan', stage: 'new', createdAt: '2026-07-19T10:00:00Z', ...overrides }
}

function quote(overrides: Partial<CRMQuote> = {}): CRMQuote {
  return { id: 'quote-1', number: 'Q-1', clientId: 'client-1', status: 'draft', lineItems: [], subtotal: 1000, hst: 130, total: 1130, deposit: 250, balance: 880, createdAt: '2026-07-19T10:00:00Z', ...overrides }
}

test('job spine follows the operational truth rather than the sales label alone', () => {
  const current = lead({ stage: 'booked', paymentStatus: 'deposit_received', assignedCrew: ['crew-1'], crewPayouts: [{ id: 'p-1', workerName: 'Sam', role: 'driver', hourlyRate: 22, approvedHours: 0, laborPay: 0, dispatchStatus: 'confirmed' }] })
  assert.equal(deriveOperatingStage(current, quote({ acceptedAt: '2026-07-19T12:00:00Z', depositPaidAt: '2026-07-19T12:01:00Z' })), 'dispatched')
})

test('readiness exposes missing operational requirements transparently', () => {
  const readiness = deriveJobReadiness(lead({ stage: 'booked', moveDate: '2026-07-20' }), quote())
  assert.notEqual(readiness.status, 'fully_ready')
  assert.ok(readiness.dimensions.flatMap(item => item.missing).includes('Crew not assigned'))
  assert.ok(readiness.dimensions.flatMap(item => item.missing).includes('Deposit unpaid'))
})

test('exceptions surface ownership and customer response risks', () => {
  const exceptions = deriveOperatingExceptions(lead({ lastInboundAt: '2026-07-19T12:00:00Z' }), null)
  assert.ok(exceptions.some(item => item.title === 'No owner assigned'))
  assert.ok(exceptions.some(item => item.title === 'Customer is waiting'))
})

test('completion exception exposes unpaid balance and missing care follow-up', () => {
  const exceptions = deriveOperatingExceptions(lead({ stage: 'completed', paymentStatus: 'deposit_received' }), quote({ balance: 800 }))
  assert.ok(exceptions.some(item => item.title === 'Completed but unpaid'))
  assert.ok(exceptions.some(item => item.title === 'Care follow-up not sent'))
  assert.ok(exceptions.some(item => item.title === 'Relationship context unfinished'))
})
