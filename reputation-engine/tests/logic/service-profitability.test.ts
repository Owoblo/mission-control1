import assert from 'node:assert/strict'
import test from 'node:test'
import { buildServiceProfitabilityPlan, classifyServiceLine } from '../../lib/service-profitability'

test('service lines are classified into operational categories', () => {
  assert.equal(classifyServiceLine('Professional packing labour'), 'packing')
  assert.equal(classifyServiceLine('Move-out cleaning'), 'cleaning')
  assert.equal(classifyServiceLine('Storage container delivery'), 'storage')
  assert.equal(classifyServiceLine('Junk removal and disposal'), 'junk')
})

test('service plan catches unpriced scope and missing storage protection', () => {
  const plan = buildServiceProfitabilityPlan({
    lineItems: [
      { description: 'Moving service', amount: 1800 },
      { description: 'Move-out cleaning', amount: 0 },
    ],
    legs: [{ id: 'storage', label: 'Storage day', type: 'storage' }],
    jobFactors: { packingStatus: 'not-started' },
    pricingBreakdown: null,
  })

  assert.equal(plan.status, 'blocked')
  assert.ok(plan.protections.some(item => /packing labour/i.test(item)))
  assert.ok(plan.protections.some(item => /storage handling/i.test(item)))
  assert.ok(plan.protections.some(item => /price or an explicit/i.test(item)))
})

test('service plan reports a healthy fully priced move', () => {
  const plan = buildServiceProfitabilityPlan({
    lineItems: [{ description: 'Full-service moving', amount: 2000 }],
    pricingBreakdown: {
      pricingStatus: 'ready',
      intelligenceFlags: { missingDestination: false } as never,
      internalCostEstimate: { totalCost: 700 } as never,
    } as never,
  })

  assert.equal(plan.grossMarginPct, 65)
  assert.equal(plan.status, 'healthy')
  assert.deepEqual(plan.protections, [])
})

test('direct cost is allocated across service packages without changing the total', () => {
  const plan = buildServiceProfitabilityPlan({
    lineItems: [
      { description: 'Moving service', amount: 1500 },
      { description: 'Professional packing', amount: 500 },
    ],
    pricingBreakdown: {
      pricingStatus: 'ready',
      intelligenceFlags: { missingDestination: false } as never,
      internalCostEstimate: { totalCost: 800 } as never,
    } as never,
  })
  const allocated = plan.packages.reduce((sum, item) => sum + item.allocatedDirectCost, 0)
  assert.ok(Math.abs(allocated - 800) <= 0.01)
  assert.ok(plan.packages.every(item => item.grossMarginPct > 0))
})
