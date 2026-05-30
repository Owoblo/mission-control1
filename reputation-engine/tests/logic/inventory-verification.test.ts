import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyInventoryVerificationToInventory,
  buildInventoryVerificationActivity,
  buildInventoryVerificationChoiceKeyMap,
  buildInventoryVerificationSummary,
} from '../../lib/inventory-verification'
import type { CRMLead, InventoryItem, InventoryVerification } from '../../lib/types'

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

test('inventory verification activity surfaces the latest customer edits with item context', () => {
  const inventory: InventoryItem[] = [
    { id: 'item_1', room: 'Living Room', name: 'Sectional Sofa', qty: 1, included: true, source: 'mls' },
  ]
  const keyMap = buildInventoryVerificationChoiceKeyMap(inventory)
  const lead: CRMLead = {
    id: 'lead_1',
    name: 'Customer Lead',
    stage: 'quoted',
    createdAt: '2026-05-20',
    inventory,
    mediaAssets: [],
    callLogs: [],
    inventoryVerification: {
      lastUpdatedAt: '2026-05-21T11:05:00.000Z',
      addressMismatchNote: 'Suite number looks wrong.',
      itemChoices: [
        {
          itemKey: keyMap.get(0) || '',
          decision: 'unsure',
          note: 'Might stay with the buyer.',
          updatedAt: '2026-05-21T11:04:00.000Z',
          updatedBy: 'customer',
        },
      ],
      addedItems: [
        {
          id: 'added_1',
          room: 'Garage',
          name: 'Snowblower',
          qty: 1,
          note: 'Also moving.',
          createdAt: '2026-05-21T11:03:00.000Z',
          createdBy: 'customer',
        },
      ],
    },
  }

  const activity = buildInventoryVerificationActivity(lead)

  assert.equal(activity.length, 3)
  assert.equal(activity[0]?.kind, 'address')
  assert.equal(activity[1]?.title, 'Sectional Sofa')
  assert.match(activity[1]?.detail || '', /flagged this for review/i)
  assert.equal(activity[2]?.title, 'Snowblower added')
})
