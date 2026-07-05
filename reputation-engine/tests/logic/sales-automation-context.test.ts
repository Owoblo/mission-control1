import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveInboundSalesContext, extractCustomerInventoryItems } from '../../lib/sales-automation-context'
import { getAutomationMissingFields } from '../../lib/sales-automation-qualification'
import type { CRMLead } from '../../lib/types'

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return {
    id: 'lead_context_test',
    name: 'Siddarth Kumar',
    stage: 'pricing',
    createdAt: '2026-07-05',
    moveDate: '2026-07-11',
    moveType: 'packing',
    originCity: 'Windsor',
    destCity: 'Windsor',
    originAddress: 'Ontario Street',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
    ...overrides,
  }
}

test('inbound context resolver splits two customer addresses and overwrites stale partial pickup', () => {
  const updated = resolveInboundSalesContext(
    lead(),
    '225 Wyandotte Street West, Windsor, N9A5X1 to 4755 Walker Road'
  )

  assert.equal(updated.originAddress, '225 Wyandotte Street West, Windsor, N9A5X1')
  assert.equal(updated.destAddress, '4755 Walker Road')

  const missing = getAutomationMissingFields(updated)
  assert.equal(missing.includes('origin_address'), false)
  assert.equal(missing.includes('destination_address'), false)
})

test('inbound context resolver captures packing inventory list from SMS', () => {
  const updated = resolveInboundSalesContext(
    lead({ originAddress: '225 Wyandotte Street West', destAddress: '4755 Walker Road' }),
    'Recliner sofa, recliner, chair, coffee, table, side table, tables, television, computer, study table, dishwasher, microwave, study, chair, bicycle, there are some items in the closet also'
  )

  const names = (updated.inventory || []).map(item => item.name)
  assert.ok(names.includes('Recliner Sofa'))
  assert.ok(names.includes('Coffee Table'))
  assert.ok(names.includes('Television'))
  assert.ok(names.includes('Closet Items'))
  assert.ok((updated.inventory || []).length >= 10)
  assert.ok((updated.totalItems || 0) >= 10)
  assert.match(updated.notes || '', /Customer listed packing\/moving items by SMS/)
})

test('inventory extractor ignores address-only messages', () => {
  const items = extractCustomerInventoryItems('225 Wyandotte Street West, Windsor to 4755 Walker Road')
  assert.equal(items.length, 0)
})
