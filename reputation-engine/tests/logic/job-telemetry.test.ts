import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveJobTelemetry } from '../../lib/job-telemetry'
import type { CRMLead, CRMQuote } from '../../lib/types'

const lead = (overrides: Partial<CRMLead> = {}): CRMLead => ({
  id: 'lead_1', name: 'Abdul', stage: 'completed', source: 'phone', createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z',
  inventory: [{ id: 'i1', name: 'Totes', item: 'Totes', qty: 40, cubicFeet: 3, weightLbs: 10, included: true }],
  ...overrides,
} as CRMLead)

const quote = (overrides: Partial<CRMQuote> = {}): CRMQuote => ({
  id: 'quote_1', number: 'Q-1', clientId: 'client_1', leadId: 'lead_1', status: 'accepted', moveType: 'long-distance', lineItems: [], subtotal: 5000, hst: 650, total: 5650, deposit: 2825, balance: 2825, estimatedHours: 10, crewSize: 3,
  pricingBreakdown: { internalCostEstimate: { laborCost: 900, truckOpsCost: 800, totalCost: 2000 } },
  createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z',
  ...overrides,
} as unknown as CRMQuote)

test('telemetry uses pre-tax revenue and compares estimate with actuals', () => {
  const result = deriveJobTelemetry({
    lead: lead(), quote: quote(),
    actuals: { actualHours: 12, actualCrew: 3, varianceReason: 'Border delay' },
    costs: [{ category: 'labor', amount_cents: 120000 }, { category: 'truck', amount_cents: 110000 }],
  })
  assert.equal(result.revenue, 5000)
  assert.equal(result.actualCost, 2300)
  assert.equal(result.actualGrossProfit, 2700)
  assert.equal(result.actualMarginPct, 54)
  assert.equal(result.hoursVariance, 2)
  assert.equal(result.primaryBottleneck, 'truck')
  assert.equal(result.estimatedVolumeCf, 120)
})

test('telemetry makes missing actuals an explicit bottleneck', () => {
  const result = deriveJobTelemetry({ lead: lead(), quote: quote() })
  assert.equal(result.primaryBottleneck, 'missing_actuals')
  assert.equal(result.actualsComplete, false)
})

test('execution issues take priority over simple cost variance', () => {
  const result = deriveJobTelemetry({
    lead: lead({ moveExecutionLog: { issues: [{ id: 'issue_1', category: 'inventory', severity: 'high', note: 'Extra room', createdAt: '2026-09-05T00:00:00Z' }] } }),
    quote: quote(), actuals: { actualHours: 11 }, costs: [{ category: 'labor', amount_cents: 95000 }],
  })
  assert.equal(result.primaryBottleneck, 'scope')
})
