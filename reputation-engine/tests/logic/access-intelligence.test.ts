import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveAccessComplexityAssessment } from '../../lib/access-intelligence'

test('access intelligence auto-clears simple house-style access', () => {
    const assessment = deriveAccessComplexityAssessment({
      jobFactors: {
        originFloors: 1,
        originHasElevator: false,
        originParkingOk: true,
        destFloors: 1,
        destHasElevator: false,
        destParkingOk: true,
      },
    })

  assert.equal(assessment.status, 'clear')
  assert.equal(assessment.extraMinutes, 0)
  assert.equal(assessment.accessAutoClear, true)
  assert.equal(assessment.parkingAutoClear, true)
})

test('access intelligence flags elevator and truck access as operational setup time', () => {
    const assessment = deriveAccessComplexityAssessment({
      jobFactors: {
        originFloors: 8,
        originHasElevator: true,
        originElevatorReserved: false,
        originParkingOk: false,
        destFloors: 1,
        destHasElevator: false,
        destParkingOk: true,
      },
    })

  assert.equal(assessment.status, 'high_risk')
  assert.equal(assessment.extraMinutes, 90)
  assert.match(assessment.summary, /elevator likely needs reservation/)
  assert.match(assessment.summary, /no direct truck access/)
})

test('access intelligence keeps unknown access from being treated as ready', () => {
    const assessment = deriveAccessComplexityAssessment({})

  assert.equal(assessment.status, 'unknown')
  assert.equal(assessment.accessAutoClear, false)
  assert.equal(assessment.parkingAutoClear, false)
})
