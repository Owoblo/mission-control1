import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getSalesWorkQueue, salesAutomationExclusion, torontoDate } from '../../lib/sales-work-queue'
import { getLeadActionSummary } from '../../lib/lead-guidance'
import type { CRMLead, CRMQuote } from '../../lib/types'

const lead = (patch: Partial<CRMLead> = {}) => ({ id: 'test', name: '+16135550123', stage: 'contacted', createdAt: '2026-10-01', ...patch } as CRMLead)

test('unknown and phone-only enquiries stay visible; partner handoffs stay in Sales', () => {
  for (const l of [lead(), lead({ name: 'Unknown Caller' }), lead({ commercialDisposition: 'lead_candidate' }), lead({ leadKind: 'partner_opportunity' })]) {
    assert.equal(getSalesWorkQueue(l), 'sales')
    assert.equal(salesAutomationExclusion(l), null)
  }
})
test('reviewed non-sales and service cases retain a separate queue without selling guidance', () => {
  for (const commercialDisposition of ['not_a_lead', 'support_case'] as const) {
    const l = lead({ commercialDisposition })
    assert.equal(getSalesWorkQueue(l), 'review')
    assert.ok(salesAutomationExclusion(l))
    assert.equal(getLeadActionSummary(l, null).category, 'non_sales_review')
    assert.equal(getLeadActionSummary(l, null).priority, 0)
  }
  assert.equal(getSalesWorkQueue(lead({ leadKind: 'realtor_opportunity' })), 'realtor')
})
test('a past unbooked move requires an outcome check even with a viewed quote', () => {
  const quote = { id: 'q', status: 'viewed', viewedAt: new Date().toISOString() } as CRMQuote
  const result = getLeadActionSummary(lead({ moveDate: '2000-01-01', stage: 'quoted' }), quote)
  assert.equal(result.category, 'outcome_review')
  assert.equal(result.primaryCta.key, 'open_lead')
  assert.equal(getLeadActionSummary(lead({ moveDate: '2000-01-01', stage: 'booked' }), quote).category === 'outcome_review', false)
})
test('Toronto date remains yesterday after UTC midnight and respects daylight savings', () => {
  assert.equal(torontoDate(new Date('2026-10-17T01:00:00Z')), '2026-10-16')
  assert.equal(torontoDate(new Date('2026-12-17T04:30:00Z')), '2026-12-16')
})
