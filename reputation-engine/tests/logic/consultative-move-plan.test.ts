import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConsultativeMovePlan } from '../../lib/consultative-move-plan'

test('unknown closing gap becomes a revisable storage journey', () => {
  const plan = buildConsultativeMovePlan({
    factors: {
      destinationTiming: 'unknown',
      temporaryStorageNeeded: true,
      storageDurationKnown: false,
      storageEstimatedMonths: 2,
      packingPreference: 'self',
      cleaningPreference: 'none',
      protectionPreference: 'standard',
    },
    destinationKnown: false,
  })
  assert.deepEqual(plan.phases.map(phase => phase.id), ['prepare', 'move_out', 'hold', 'move_in', 'settle'])
  assert.match(plan.phases.find(phase => phase.id === 'hold')?.summary || '', /2 months/i)
  assert.ok(plan.assumptions.some(item => /actual duration adjusts/i.test(item)))
  assert.equal(plan.canBeBinding, false)
})

test('consultation asks only unresolved questions and recognizes included services', () => {
  const plan = buildConsultativeMovePlan({
    factors: {
      destinationTiming: 'same_day',
      packingPreference: 'full_service',
      cleaningPreference: 'move_out',
      protectionPreference: 'enhanced',
    },
    lineItems: [
      { description: 'Professional Packing Service', amount: 900 },
      { description: 'Move-out Cleaning', amount: 350 },
      { description: 'Enhanced Valuation Protection', amount: 125 },
    ],
  })
  assert.deepEqual(plan.questions, [])
  assert.deepEqual(plan.assumptions, [])
  assert.equal(plan.canBeBinding, true)
})

test('a customer targeting the first week of August can receive a locked-scope estimate now', () => {
  const plan = buildConsultativeMovePlan({
    lead: {
      moveDateFlexible: true,
      moveDateFlexibleReason: 'First week of August',
      originAddress: '27 Conroy Crescent, Guelph, ON',
      destCity: 'Ottawa',
      propertyType: 'apartment',
      followUpDate: '2026-08-01',
    },
    factors: {
      destinationTiming: 'same_day',
      packingPreference: 'self',
      cleaningPreference: 'none',
      protectionPreference: 'standard',
    },
    destinationKnown: false,
  })

  assert.equal(plan.estimateMode, 'locked_scope')
  assert.match(plan.estimateMessage, /price the known white-glove scope now/i)
  assert.ok(plan.knownNow.some(item => /first week of august/i.test(item)))
  assert.ok(plan.finalizeLater.includes('Exact move date and crew availability'))
  assert.ok(plan.nudges.some(item => item.key === 'confirm_exact_date' && /2026-08-01/.test(item.trigger)))
})

test('waiting for a home sale produces a sale milestone without withholding the estimate', () => {
  const plan = buildConsultativeMovePlan({
    lead: {
      moveDateFlexible: true,
      moveDateFlexibleReason: 'Waiting for the house to sell',
      originAddress: '100 Riverside Drive, Windsor, ON',
      destCity: 'London',
      tentativeReason: 'waiting_for_sale',
      followUpDate: '2026-08-15',
    },
    factors: {
      destinationTiming: 'unknown',
      temporaryStorageNeeded: true,
      storageDurationKnown: false,
      storageEstimatedMonths: 2,
      packingPreference: 'full_service',
      cleaningPreference: 'move_out',
      protectionPreference: 'enhanced',
    },
    destinationKnown: false,
  })

  assert.equal(plan.estimateMode, 'locked_scope')
  assert.ok(plan.nudges.some(item => item.key === 'review_home_sale'))
  assert.ok(plan.nudges.some(item => item.key === 'confirm_storage_end'))
  assert.ok(plan.recommendedServices.includes('packing'))
  assert.ok(plan.recommendedServices.includes('storage'))
  assert.ok(plan.recommendedServices.includes('cleaning'))
  assert.ok(plan.recommendedServices.includes('protection'))
})

test('city-only destination asks one property question and preserves route assumptions', () => {
  const plan = buildConsultativeMovePlan({
    lead: {
      moveDate: '2026-09-10',
      originAddress: '55 King Street, Waterloo, ON',
      destCity: 'Toronto',
    },
    factors: {
      destinationTiming: 'same_day',
      packingPreference: 'self',
      cleaningPreference: 'none',
      protectionPreference: 'standard',
    },
    destinationKnown: false,
  })

  assert.equal(plan.estimateMode, 'locked_scope')
  assert.ok(plan.questions.some(question => /house, apartment, condo, or storage/i.test(question)))
  assert.ok(plan.assumptions.some(item => /travel is modeled to toronto/i.test(item)))
  assert.ok(plan.nudges.some(item => item.key === 'confirm_destination_property'))
})

test('journey simulations cover common white-glove uncertainty without restarting the plan', () => {
  const simulations = [
    { name: 'exact local move', lead: { moveDate: '2026-08-20', originAddress: '1 A St', destAddress: '2 B St', propertyType: 'detached_house' as const }, destinationKnown: true, expected: 'firm' },
    { name: 'date TBD', lead: { moveDateFlexible: true, moveDateFlexibleReason: 'Mid-August', originAddress: '1 A St', destAddress: '2 B St' }, destinationKnown: true, expected: 'locked_scope' },
    { name: 'city known', lead: { moveDate: '2026-08-20', originAddress: '1 A St', destCity: 'Ottawa', propertyType: 'condo' as const }, destinationKnown: false, expected: 'locked_scope' },
    { name: 'sale pending', lead: { moveDateFlexible: true, moveDateFlexibleReason: 'Waiting for buyer', originAddress: '1 A St', destCity: 'London', tentativeReason: 'waiting_for_sale' as const }, destinationKnown: false, expected: 'locked_scope' },
    { name: 'planning inquiry', lead: { destCity: 'Windsor' }, destinationKnown: false, expected: 'provisional' },
  ] as const

  for (const simulation of simulations) {
    const plan = buildConsultativeMovePlan({
      lead: simulation.lead,
      factors: {
        destinationTiming: 'same_day',
        packingPreference: 'self',
        cleaningPreference: 'none',
        protectionPreference: 'standard',
      },
      destinationKnown: simulation.destinationKnown,
    })
    assert.equal(plan.estimateMode, simulation.expected, simulation.name)
    assert.ok(plan.estimateMessage.length > 40, simulation.name)
  }
})
