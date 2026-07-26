import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTentativeReservationSms, buildTentativeReservationUpdate, reconcileTentativeReservation } from '../../lib/tentative-reservation'

test('tentative reservation creates a real follow-up and expiry', () => {
  const update = buildTentativeReservationUpdate({
    moveDate: '2026-08-20',
    decisionDate: '2026-08-05',
    reason: 'waiting_for_closing',
    now: new Date('2026-07-25T12:00:00Z'),
  })
  assert.equal(update.stage, 'tentative')
  assert.equal(update.followUpDate, '2026-08-05')
  assert.equal(update.tentativeReservationStatus, 'active')
  assert.match(update.tentativeExpiresAt || '', /^2026-08-05/)
})

test('customer message explains the courtesy hold without pretending it is booked', () => {
  const message = buildTentativeReservationSms({
    customerName: 'Lauren O’Brien',
    moveDate: '2026-08-20',
    decisionDate: '2026-08-05',
  })
  assert.match(message, /courtesy hold/i)
  assert.match(message, /not a confirmed booking or deposit/i)
  assert.match(message, /adjust the plan with you/i)
})

test('past decision dates are rejected', () => {
  assert.throws(() => buildTentativeReservationUpdate({
    decisionDate: '2026-07-20',
    reason: 'other',
    now: new Date('2026-07-25T12:00:00Z'),
  }))
})

test('expired holds move to nurture and require human review without messaging the customer', () => {
  const result = reconcileTentativeReservation({
    id: 'lead-1',
    name: 'Customer',
    stage: 'tentative',
    tentativeReservationStatus: 'active',
    tentativeExpiresAt: '2026-07-24T23:59:59.999Z',
    createdAt: '2026-07-01T00:00:00Z',
  }, new Date('2026-07-25T12:00:00Z'))
  assert.equal(result.outcome, 'expired')
  assert.equal(result.lead.stage, 'nurture')
  assert.match(result.lead.followUpNote || '', /before promising the date again/i)
  assert.equal(result.lead.tentativeCustomerNotifiedAt, undefined)
})

test('booked tentative reservations reconcile as converted', () => {
  const result = reconcileTentativeReservation({
    id: 'lead-2',
    name: 'Customer',
    stage: 'booked',
    tentativeReservationStatus: 'active',
    createdAt: '2026-07-01T00:00:00Z',
  })
  assert.equal(result.outcome, 'converted')
  assert.equal(result.lead.tentativeReservationStatus, 'converted')
})
