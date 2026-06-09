import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMovePolicyToInventory, getMovePolicyFinding } from '../../lib/move-policy'
import type { InventoryItem } from '../../lib/types'

test('move policy keeps safes included as priced specialty handling', () => {
  const item: InventoryItem = {
    name: 'Small Fireproof Safe',
    room: 'Bedroom',
    qty: 1,
    cubicFeet: 4,
    weightLbs: 85,
    included: true,
    source: 'manual',
  }

  const finding = getMovePolicyFinding(item)
  const [pricedItem] = applyMovePolicyToInventory([item])

  assert.equal(finding?.category, 'specialty_fee')
  assert.equal(finding?.forceExclude, false)
  assert.equal(pricedItem.included, true)
  assert.notEqual(pricedItem.status, 'excluded')
  assert.match(pricedItem.notes || '', /safe handling/i)
})

test('move policy still blocks hot tubs from normal moving scope', () => {
  const item: InventoryItem = {
    name: 'Hot Tub',
    room: 'Backyard',
    qty: 1,
    cubicFeet: 200,
    weightLbs: 900,
    included: true,
    source: 'manual',
  }

  const [pricedItem] = applyMovePolicyToInventory([item])

  assert.equal(pricedItem.included, false)
  assert.equal(pricedItem.exclusionReason, 'Hot tubs are not included. A separate specialty mover is required.')
})
