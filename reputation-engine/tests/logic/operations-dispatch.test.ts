import assert from 'node:assert/strict'
import { deriveOpsChecklist, normalizeCrewPayouts } from '../../lib/operations'

const payouts = normalizeCrewPayouts([
  {
    id: 'payout_1',
    workerName: 'Driver One',
    workerEmail: 'driver@example.com',
    workerPhone: '226-555-0100',
    role: 'driver',
    hourlyRate: 22,
    approvedHours: 6,
    laborPay: 132,
    paymentMethod: 'interac',
    payoutStatus: 'submitted',
    dispatchStatus: 'confirmed',
    dispatchToken: 'crew_token_123',
    dispatchSentAt: '2026-06-01T12:00:00.000Z',
    dispatchConfirmedAt: '2026-06-01T12:10:00.000Z',
  },
])

assert.equal(payouts?.[0]?.dispatchStatus, 'confirmed')
assert.equal(payouts?.[0]?.dispatchToken, 'crew_token_123')
assert.equal(payouts?.[0]?.dispatchConfirmedAt, '2026-06-01T12:10:00.000Z')

const checklist = deriveOpsChecklist({
  assignedCrew: [],
  crewPayouts: payouts,
  opsChecklist: {},
  truckReservationStatus: 'reserved',
})

assert.equal(checklist.crewAssigned, true)
assert.equal(checklist.truckReserved, true)
