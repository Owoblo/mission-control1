import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveAccessComplexityAssessment } from '../../lib/access-intelligence'

test('access intelligence clears documented simple routes', () => {
    const assessment = deriveAccessComplexityAssessment({
      originAccess: 'Ground level, direct doorway', destAccess: 'Ground level, direct doorway', parkingNotes: 'Driveway at each address',
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

test('access intelligence includes conjoint second pickup apartment setup time', () => {
    const assessment = deriveAccessComplexityAssessment({
      jobFactors: {
        conjointMove: true,
        originFloors: 6,
        originHasElevator: true,
        originElevatorReserved: true,
        originParkingOk: true,
        personBOriginFloors: 15,
        personBOriginHasElevator: true,
        personBOriginElevatorReserved: false,
        personBOriginParkingOk: false,
        destFloors: 1,
        destHasElevator: false,
        destParkingOk: true,
      },
    })

  assert.equal(assessment.status, 'high_risk')
  assert.equal(assessment.extraMinutes, 90)
  assert.match(assessment.summary, /Second pickup: elevator likely needs reservation/)
  assert.match(assessment.summary, /Second pickup: no direct truck access/)
  assert.equal(assessment.parkingAutoClear, false)
})

test('access intelligence keeps unknown access from being treated as ready', () => {
    const assessment = deriveAccessComplexityAssessment({})

  assert.equal(assessment.status, 'unknown')
  assert.equal(assessment.accessAutoClear, false)
  assert.equal(assessment.parkingAutoClear, false)
})

 test('inferred single-floor defaults cannot establish confirmed access', () => {
  const result = deriveAccessComplexityAssessment({ jobFactors: { originFloors: 1, destFloors: 1, originParkingOk: true, destParkingOk: true } })
  assert.equal(result.status, 'unknown')
  assert.equal(result.accessAutoClear, false)
  assert.equal(result.parkingAutoClear, false)
})

test('confirmed driveway profiles clear access without legacy text fields', async () => {
  const { createStandardAccessProfile } = await import('../../lib/access-profile')
  const { buildMoveOperatingPlan, buildCurrentCrewBrief } = await import('../../lib/move-operating-plan')
  const profiles = [
    createStandardAccessProfile({ id: 'o', stopId: 'primary-origin', stopRole: 'pickup', label: 'Origin' }),
    createStandardAccessProfile({ id: 'd', stopId: 'primary-destination', stopRole: 'dropoff', label: 'Destination' }),
  ]
  const lead = { id: 'driveway', name: 'Customer', stage: 'pricing' as const, createdAt: '2026-09-28', jobFactors: { accessProfiles: profiles }, inventory: [{ name: 'Sofa', cubicFeet: 70, weightLbs: 120 }] }
  const assessment = deriveAccessComplexityAssessment(lead)
  assert.equal(assessment.status, 'clear')
  assert.equal(assessment.parkingAutoClear, true)
  assert.equal(assessment.extraMinutes, 0)
  const plan = buildMoveOperatingPlan(lead)
  assert.equal(plan.originKnown, true)
  assert.equal(plan.destinationKnown, true)
  assert.ok(!plan.reasons.some(reason => /carrying route|Parking/.test(reason)))
  assert.doesNotMatch(buildCurrentCrewBrief(lead), /access: UNCONFIRMED|Parking: UNCONFIRMED/)
  assert.notEqual(deriveAccessComplexityAssessment({ ...lead, jobFactors: { accessProfiles: profiles.slice(0, 1) } }).status, 'clear')
  assert.notEqual(deriveAccessComplexityAssessment({ ...lead, jobFactors: { accessProfiles: [profiles[0], { ...profiles[1], unsafeAccess: true }] } }).status, 'clear')
})
