import assert from 'node:assert/strict'
import test from 'node:test'
import { adviseDynamicPrice } from '../../lib/dynamic-pricing'

test('dynamic pricing uses operational constraints and exposes its reasons', () => {
  const result = adviseDynamicPrice({
    baseAmount: 1_000,
    daysUntilMove: 1,
    branchCapacityPct: 94,
    scopeConfidence: 'high',
    routeRisk: 'medium',
    accessRisk: 'low',
    complexity: 'multi_stop',
  })

  assert.equal(result.adjustmentPct, 15)
  assert.equal(result.recommendedAmount, 1_150)
  assert.equal(result.requiresReview, true)
  assert.ok(result.reasons.some(reason => /capacity/i.test(reason)))
})

test('low-confidence scope is presented as a range and requires review', () => {
  const result = adviseDynamicPrice({
    baseAmount: 1_000,
    branchCapacityPct: 20,
    scopeConfidence: 'low',
  })

  assert.equal(result.requiresReview, true)
  assert.ok(result.floorAmount < result.recommendedAmount)
  assert.ok(result.ceilingAmount > result.recommendedAmount)
})

test('referral discount is explicit and capped', () => {
  const result = adviseDynamicPrice({
    baseAmount: 1_000,
    scopeConfidence: 'high',
    referralDiscountPct: 0.5,
  })

  assert.equal(result.adjustmentPct, -15)
  assert.equal(result.recommendedAmount, 850)
  assert.ok(result.reasons.some(reason => /referral discount/i.test(reason)))
})
