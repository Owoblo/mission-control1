import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDetectedInventoryDimensions } from '../../lib/inventory-dimension-safety'
import { matchInventoryPreset } from '../../lib/item-presets'

test('grouped box totals are converted to per-item values before multiplication', () => {
  const result = normalizeDetectedInventoryDimensions({
    name: 'Stack of Moving Boxes',
    qty: 15,
    cubicFeet: 90,
    weightLbs: 600,
  })

  assert.equal(result.cubicFeet, 6)
  assert.equal(result.weightLbs, 40)
  assert.equal(result.adjusted, true)
})

test('grouped dining-chair totals are converted using catalog expectations', () => {
  const result = normalizeDetectedInventoryDimensions({
    name: 'Upholstered Dining Chairs',
    qty: 4,
    cubicFeet: 20,
    weightLbs: 80,
  })

  assert.equal(result.cubicFeet, 5)
  assert.equal(result.weightLbs, 20)
  assert.equal(result.adjusted, true)
})

test('normal single-item survey dimensions remain unchanged', () => {
  const result = normalizeDetectedInventoryDimensions({
    name: '3-seat tufted sofa',
    qty: 1,
    cubicFeet: 90,
    weightLbs: 220,
  })

  assert.equal(result.cubicFeet, 90)
  assert.equal(result.weightLbs, 220)
  assert.equal(result.adjusted, false)
})

test('piano accessories do not match a full piano preset', () => {
  assert.equal(matchInventoryPreset('Collapsible piano stand'), null)
  assert.equal(matchInventoryPreset('Keyboard stand'), null)
  assert.ok(matchInventoryPreset('Upright piano'))
  assert.ok(matchInventoryPreset('Piano bench'))
})
