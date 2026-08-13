import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContributionPricingPlan } from '../../lib/contribution-pricing'

test('major move price is solved backwards from fulfillment cost and margin', () => {
  const plan = buildContributionPricingPlan({
    currentPrice: 5000,
    binding: true,
    pricing: { internalCostEstimate: { laborCost: 1800, truckOpsCost: 450, suppliesCost: 75, commercialDirectCost: 0 } } as never,
    lineItems: [{ description: 'Full-Service Moving', amount: 5000 }, { description: '20 Complimentary Moving Boxes', amount: 0 }],
  })
  assert.equal(plan.isMajorMove, true)
  assert.ok(plan.costs.some(cost => cost.key === 'box_delivery'))
  assert.ok(plan.recommendedPrice >= plan.minimumAuthorizedPrice)
  assert.ok(plan.expectedContribution > 0)
  assert.equal(plan.reserves.length, 5)
  assert.ok(plan.executionContingencyTotal > (plan.costs.find(cost => cost.key === 'contingency')?.amount || 0))
})

test('storage and junk allowances become real internal costs', () => {
  const plan = buildContributionPricingPlan({
    currentPrice: 7000,
    factors: { temporaryStorageNeeded: true, storageEstimatedMonths: 2, storageMonthlyAllowance: 200 },
    pricing: { internalCostEstimate: { laborCost: 2200, truckOpsCost: 500 } } as never,
    lineItems: [{ description: 'Junk Removal Service', amount: 500 }],
  })
  assert.equal(plan.costs.find(cost => cost.key === 'storage')?.amount, 400)
  assert.equal(plan.costs.find(cost => cost.key === 'junk')?.amount, 225)
})
