import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeInventoryRooms } from '../../lib/inventory-sanitizer'
import type { InventoryItem } from '../../lib/types'

test('inventory sanitizer excludes apartment amenity common-area scan noise', () => {
  const inventory: InventoryItem[] = [
    {
      name: 'Treadmill',
      room: 'Building Gym',
      qty: 1,
      cubicFeet: 65,
      weightLbs: 250,
      included: true,
      source: 'mls',
    },
    {
      name: 'Lobby Sofa',
      room: 'Lobby Lounge',
      qty: 1,
      cubicFeet: 90,
      weightLbs: 220,
      included: true,
      source: 'mls',
    },
  ]

  const sanitized = sanitizeInventoryRooms(inventory)

  assert.equal(sanitized[0].included, false)
  assert.equal(sanitized[0].status, 'excluded')
  assert.match(sanitized[0].exclusionReason || '', /amenity\/common area/i)
  assert.equal(sanitized[1].included, false)
  assert.equal(sanitized[1].status, 'excluded')
})

test('inventory sanitizer keeps real apartment unit furniture', () => {
  const inventory: InventoryItem[] = [
    {
      name: '3-Seat Sofa',
      room: 'Living Room',
      sourcePhotoRoom: 'living_room',
      qty: 1,
      cubicFeet: 90,
      weightLbs: 220,
      included: true,
      source: 'rep_upload',
    },
  ]

  const sanitized = sanitizeInventoryRooms(inventory)

  assert.equal(sanitized[0].included, true)
  assert.equal(sanitized[0].status, undefined)
  assert.equal(sanitized[0].room, 'Living Room')
})
