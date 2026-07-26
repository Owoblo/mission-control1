import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInventorySmsReference,
  buildMlsInventoryConfirmationSms,
  mergeInventorySmsUpdate,
} from '../../lib/sales-automation-inventory-sms'
import type { CRMLead } from '../../lib/types'

function lead(overrides: Partial<CRMLead>): CRMLead {
  return {
    id: 'lead_sms_inventory',
    name: 'Salma Elasfar',
    stage: 'new',
    createdAt: '2026-06-30',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
    ...overrides,
  }
}

test('MLS inventory SMS is grouped by room for customer confirmation', () => {
  const body = buildMlsInventoryConfirmationSms(lead({
    inventory: [
      { room: 'Living Room', name: 'Sofa', qty: 1, included: true, source: 'mls' },
      { room: 'Bedroom 1', name: 'Queen Bed', qty: 1, included: true, source: 'mls' },
    ],
  }))

  assert.match(body, /Living Room: Sofa/)
  assert.match(body, /Bedroom 1: Queen Bed/)
  assert.match(body, /anything shown staying behind/i)
  assert.match(body, /don't have to list everything from scratch/i)
  assert.doesNotMatch(body, /reply yes/i)
})

test('MLS inventory SMS does not claim a scan when only customer inventory exists', () => {
  const body = buildMlsInventoryConfirmationSms(lead({
    inventory: [
      { room: 'Packing scope', name: 'Recliner Sofa', qty: 1, included: true, source: 'customer_verification' },
    ],
  }))

  assert.match(body, /couldn't build a clear starter inventory from the property information in our system/i)
  assert.doesNotMatch(body, /pulled a starter inventory/i)
  assert.doesNotMatch(body, /reply yes/i)
})

test('SMS inventory updates can exclude scanned items and add hidden inventory', () => {
  const baseLead = lead({
    inventory: [
      { room: 'Living Room', name: 'Sofa', qty: 1, included: true },
      { room: 'Bedroom 1', name: 'Queen Bed', qty: 1, included: true },
    ],
  })
  const reference = buildInventorySmsReference(baseLead)
  const sofaKey = reference.find(item => item.name === 'Sofa')?.itemKey || ''

  const updated = mergeInventorySmsUpdate(baseLead, {
    itemChoices: [{ itemKey: sofaKey, decision: 'not_going', note: 'Staying behind' }],
    addedItems: [{ room: 'Garage', name: 'Tool chest', qty: 1 }],
    complete: true,
    summary: 'Sofa is staying and tool chest was added.',
  }, '2026-06-30T05:00:00.000Z')

  assert.equal(updated.inventoryVerification?.completedAt, '2026-06-30T05:00:00.000Z')
  assert.equal(updated.inventory.find(item => item.name === 'Sofa')?.included, false)
  assert.equal(updated.inventory.find(item => item.name === 'Tool chest')?.source, 'customer_verification')
  assert.equal(updated.totalItems, 2)
})
