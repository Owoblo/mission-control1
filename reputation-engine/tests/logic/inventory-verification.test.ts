import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyInventoryVerificationToInventory,
  buildInventoryVerificationChoiceKeyMap,
  buildInventoryVerificationSummary,
} from '../../lib/inventory-verification'
import type { InventoryItem, InventoryVerification } from '../../lib/types'

test('inventory verification converts customer decisions into scoped inventory updates', () => {
  const inventory: InventoryItem[] = [
    { id: 'item_1', room: 'Living Room', name: 'Sectional Sofa', qty: 1, cubicFeet: 90, weightLbs: 240, included: true, source: 'mls' },
    { id: 'item_2', room: 'Bedroom 1', name: 'Queen Bed', qty: 1, cubicFeet: 55, weightLbs: 180, included: true, source: 'mls' },
  ]

  const keyMap = buildInventoryVerificationChoiceKeyMap(inventory)
  const verification: InventoryVerification = {
    addressConfirmed: false,
    addressMismatchNote: 'This looks like unit 603, not 601.',
    itemChoices: [
      {
        itemKey: keyMap.get(0) || '',
        decision: 'not_going',
        note: 'Seller is leaving this behind.',
        updatedAt: '2026-05-14T10:00:00.000Z',
      },
      {
        itemKey: keyMap.get(1) || '',
        decision: 'going',
        note: 'Bed is definitely moving.',
        updatedAt: '2026-05-14T10:01:00.000Z',
      },
    ],
    addedItems: [
      {
        id: 'added_1',
        room: 'Garage',
        name: 'Snowblower',
        qty: 1,
        note: 'Also moving from the garage.',
        createdAt: '2026-05-14T10:02:00.000Z',
      },
    ],
  }

  const updatedInventory = applyInventoryVerificationToInventory(inventory, verification)
  const summary = buildInventoryVerificationSummary(verification)

  assert.equal(summary.notGoingCount, 1)
  assert.equal(summary.goingCount, 1)
  assert.equal(summary.addedCount, 1)
  assert.equal(summary.addressMismatch, true)

  assert.equal(updatedInventory.length, 3)
  assert.equal(updatedInventory[0].included, false)
  assert.equal(updatedInventory[0].status, 'excluded')
  assert.match(updatedInventory[0].confirmReason || '', /leaving this behind/i)
  assert.equal(updatedInventory[1].status, 'confirmed')
  assert.match(updatedInventory[1].confirmReason || '', /definitely moving/i)
  assert.equal(updatedInventory[2].source, 'customer_verification')
  assert.equal(updatedInventory[2].room, 'Garage')
})
