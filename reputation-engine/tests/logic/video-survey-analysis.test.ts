import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clusterVideoInventoryCandidates,
  normalizeVideoInventoryLabel,
  normalizeVideoInventoryRoom,
  reconcileVideoInventorySources,
} from '../../lib/video-survey-analysis'

test('normalizes common moving inventory aliases', () => {
  assert.equal(normalizeVideoInventoryLabel('Grey Sectional Couch'), 'grey sofa')
  assert.equal(normalizeVideoInventoryLabel('Bedside Table'), 'nightstand')
  assert.equal(normalizeVideoInventoryRoom('Master Bedroom'), 'primary bedroom')
})

test('clusters repeated sightings in the same room and time window', () => {
  const clustered = clusterVideoInventoryCandidates([
    { id: 'a', room: 'Living Room', itemName: 'Grey couch', quantity: 1, disposition: 'moving', confidence: 0.82, sourceKind: 'video', offsetMs: 10_000 },
    { id: 'b', room: 'Family Room', itemName: 'Grey sofa', quantity: 1, disposition: 'moving', confidence: 0.88, sourceKind: 'snapshot', offsetMs: 28_000 },
  ])
  assert.equal(clustered.length, 1)
  assert.equal(clustered[0].quantity, 1)
  assert.ok(clustered[0].duplicateGroupId)
  assert.ok((clustered[0].duplicateConfidence || 0) >= 0.8)
})

test('does not merge same item after a distant room pass', () => {
  const clustered = clusterVideoInventoryCandidates([
    { id: 'a', room: 'Bedroom', itemName: 'Nightstand', quantity: 1, disposition: 'moving', confidence: 0.8, sourceKind: 'video', offsetMs: 10_000 },
    { id: 'b', room: 'Bedroom', itemName: 'Night stand', quantity: 1, disposition: 'moving', confidence: 0.8, sourceKind: 'video', offsetMs: 180_000 },
  ], 60_000)
  assert.equal(clustered.length, 2)
})

test('does not merge matching furniture from different numbered bedrooms', () => {
  const clustered = clusterVideoInventoryCandidates([
    { id: 'a', room: 'Bedroom 1', itemName: 'Queen bed', quantity: 1, disposition: 'moving', confidence: 0.9, sourceKind: 'video', offsetMs: 10_000 },
    { id: 'b', room: 'Bedroom 2', itemName: 'Queen bed', quantity: 1, disposition: 'moving', confidence: 0.9, sourceKind: 'video', offsetMs: 30_000 },
  ])
  assert.equal(clustered.length, 2)
  assert.equal(normalizeVideoInventoryRoom('Bedroom 2'), 'bedroom 2')
})

test('contradictory spoken and visual disposition requires review', () => {
  const reconciled = reconcileVideoInventorySources({
    video: [
      { id: 'visual', room: 'Garage', itemName: 'Tool chest', quantity: 1, disposition: 'moving', confidence: 0.86, sourceKind: 'video', offsetMs: 5_000 },
    ],
    transcript: [
      { id: 'spoken', room: 'Garage', itemName: 'Tool chest', quantity: 1, disposition: 'staying', confidence: 0.95, sourceKind: 'transcript', offsetMs: 6_000 },
    ],
  })
  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0].disposition, 'uncertain')
})
