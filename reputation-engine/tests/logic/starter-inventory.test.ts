import assert from 'node:assert/strict'
import { buildStarterInventoryPlan, mergeStarterInventory } from '../../lib/starter-inventory'
import type { InventoryItem } from '../../lib/types'

const condoPlan = buildStarterInventoryPlan({
  bedrooms: '2_bedrooms',
  propertyType: 'condo',
})

assert.ok(condoPlan)
assert.equal(condoPlan?.title.includes('Condo'), true)
assert.equal(condoPlan?.warnings.some(item => item.toLowerCase().includes('elevator')), true)
assert.equal((condoPlan?.items.length || 0) > 0, true)

const existing: InventoryItem[] = [
  { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
]

const merged = mergeStarterInventory(existing, [
  { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
  { room: 'Bedroom', name: 'Mattress · Queen', qty: 1, included: true },
])

assert.equal(merged.length, 2)
assert.equal(merged.some(item => item.room === 'Bedroom'), true)
