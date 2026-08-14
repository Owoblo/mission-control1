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
  assert.deepEqual(plan.reserves.map(item => item.key), ['card_processing'])
  assert.ok(plan.executionContingencyTotal > (plan.costs.find(cost => cost.key === 'contingency')?.amount || 0))
})

test('operational contingency responds to move context without re-adding overhead', () => {
  const local = buildContributionPricingPlan({
    currentPrice: 2500,
    quoteType: 'labor_only',
    pricing: { routeCategory: 'local', totalHours: 4, truckCount: 1, crewSize: 2, internalCostEstimate: { laborCost: 400, truckOpsCost: 0 } } as never,
  })
  const longDistance = buildContributionPricingPlan({
    currentPrice: 7000,
    quoteType: 'long_distance',
    pricing: { routeCategory: 'long-distance', totalHours: 16, truckCount: 2, crewSize: 4, internalCostEstimate: { laborCost: 1800, truckOpsCost: 900 } } as never,
  })
  assert.equal(local.operationalContingencyRate, 0.04)
  assert.ok(longDistance.operationalContingencyRate > local.operationalContingencyRate)
  assert.deepEqual(longDistance.reserves.map(item => item.key), ['card_processing'])
  assert.ok(longDistance.costs.some(item => item.key === 'lodging'))
  assert.ok(longDistance.costs.some(item => item.key === 'crew_meals'))
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

test('TV protection uses inventory sizes instead of a flat per-TV guess', () => {
  const plan = buildContributionPricingPlan({
    currentPrice: 5000,
    pricing: { routeCategory: 'local', crewSize: 3, truckCount: 1, adjustmentBreakdown: [], internalCostEstimate: { laborCost: 900, truckOpsCost: 300 } } as never,
    lineItems: [{ description: 'TV Protection', details: '2 TVs', amount: 0 }],
    inventory: [
      { name: '65-inch TV', qty: 1, included: true },
      { name: '75-inch TV', qty: 1, included: true },
    ],
  })
  assert.equal(plan.costs.find(item => item.key === 'tv_boxes')?.amount, 67)
  assert.match(plan.costs.find(item => item.key === 'tv_boxes')?.label || '', /1× Large.*1× XL/)
})
