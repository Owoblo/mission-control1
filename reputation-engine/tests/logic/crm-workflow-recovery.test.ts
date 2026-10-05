import assert from 'node:assert/strict'
import test from 'node:test'
import { computeJobPenalties } from '../../lib/sales'
import { calculateStopAccess } from '../../lib/access-profile'
import { INVENTORY_PRESETS } from '../../lib/item-presets'
import { classifyPhotosByRoom, detectFurnitureInRoom, mapScanRooms } from '../../lib/server/inventory-enrichment'

test('recorded box inventory is not charged again as expected boxes', () => {
  const boxes = [{ name: 'Moving Boxes', qty: 70, cubicFeet: 1.5, included: true }]
  assert.equal(computeJobPenalties({ estimatedBoxes: 70 }, boxes).extraCubicFeet, 0)
  assert.equal(computeJobPenalties({ estimatedBoxes: 80 }, [{ name: 'Box Spring', qty: 80, included: true }]).extraCubicFeet, 45)
  assert.equal(computeJobPenalties({ estimatedBoxes: 80 }, boxes).extraCubicFeet, 15)
  assert.equal(computeJobPenalties({ estimatedBoxes: 80 }, [{ ...boxes[0], included: false }]).extraCubicFeet, 45)
})
test('one total walking answer satisfies route evidence without three duplicate inputs', () => {
  const profile = { id: 'a', stopId: 'primary-origin', stopRole: 'pickup' as const, label: 'Origin', totalWalkMinutes: 1, verticalMode: 'stairs' as const, stairFlights: 2, evidenceStatus: 'customer_confirmed' as const }
  const plan = calculateStopAccess(profile, 3)
  assert.equal(plan.ready, true)
  assert.ok(plan.additionalAccessHours > 0)
  assert.equal(calculateStopAccess({ ...profile, totalWalkMinutes: 9 }, 3).ready, false)
})
test('queen bed set explicitly includes component volumes and preserves size', () => {
  const bed = INVENTORY_PRESETS.find(item => item.id === 'queen-bed-set')!
  assert.equal(bed.item.cubicFeet, 35 + 15 + 35)
  assert.match(bed.item.name!, /Queen/)
  assert.match(bed.item.notes!, /instead of separate/)
  assert.match(INVENTORY_PRESETS.find(item => item.id === 'mattress-queen')!.item.name!, /Queen/)
})
test('classification covers every photo exactly once, including omitted patio photo', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ kitchen_main: [0, 0, 1, 500], outdoor: [1] }) } }] })
    const grouped = await classifyPhotosByRoom(['kitchen', 'dining', 'patio'], { apiKey: 'fixture', model: 'fixture' })
    assert.deepEqual(Object.values(grouped).flat().sort(), ['dining', 'kitchen', 'patio'])
    assert.deepEqual(grouped.other, ['patio'])
  } finally { globalThis.fetch = original }
})
test('room detection examines every unique photo and rejects malformed model results', async () => {
  const original = globalThis.fetch
  try {
    const photos = Array.from({ length: 8 }, (_, i) => `https://photos.invalid/${i}`)
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.messages[0].content.filter((x: {type:string}) => x.type === 'image_url').length, 8)
      return Response.json({ choices: [{ message: { content: 'incomplete JSON' } }] })
    }
    await assert.rejects(detectFurnitureInRoom('outdoor', photos, { apiKey: 'fixture', model: 'fixture' }), /incomplete/)
  } finally { globalThis.fetch = original }
})
test('room scanning is bounded, ordered and rejects a partial scan', async () => {
  let active = 0, max = 0
  const result = await mapScanRooms([1, 2, 3, 4], async x => { active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 2)); active--; return x * 2 })
  assert.equal(max, 2)
  assert.deepEqual(result, [2, 4, 6, 8])
  await assert.rejects(mapScanRooms([1, 2, 3], async x => { if (x === 2) throw new Error('patio failed'); return x }), /patio failed/)
})

import { bundledPriceItems } from '../../lib/quote-bundled-price'
test('a selected customer price includes separate services exactly once', () => {
  const items = bundledPriceItems(1600, [{description:'Packing', amount:300}, {description:'Protection', amount:100}], 'Test')
  assert.equal(items[0].amount, 1200)
  assert.equal(items.reduce((sum, item) => sum + item.amount, 0), 1600)
  assert.equal(items.length, 3)
  assert.throws(() => bundledPriceItems(50, [{description:'Packing',amount:100}], 'Test'), /less than/)
})

import { estimateLeadQuote } from '../../lib/sales'
import type { CRMLead } from '../../lib/types'
test('customer disassembly reduces the calculated hours and price while keeping reassembly', () => {
  const lead = { id: 'assembly-fixture', name: 'Fixture', stage: 'new', createdAt: '2026-10-04', moveType: 'residential', inventory: [{ name: 'Queen Bed Frame', qty: 4, cubicFeet: 35, weightLbs: 100, included: true }, { name: 'Sofa', qty: 10, cubicFeet: 55, weightLbs: 110, included: true }], totalCubicFeet: 690, totalWeightLbs: 1500 } as CRMLead
  const both = estimateLeadQuote(lead, {}, { disassemblyMode: 'both' })
  const reassembly = estimateLeadQuote(lead, {}, { disassemblyMode: 'reassemble_only' })
  assert.ok(reassembly.estimatedHours < both.estimatedHours)
  assert.ok(reassembly.total < both.total)
})
