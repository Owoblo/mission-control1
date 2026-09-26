import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPhotoScanPlan } from '../../lib/photo-scan-plan'

test('identical files under different rooms are scanned only in the first room', () => {
  const first = { url: 'photo-4', room: 'Bedroom 1' }
  const duplicate = { url: 'photo-13', room: 'Office / Den' }
  const plan = buildPhotoScanPlan([first, duplicate], ['photo-4'])
  assert.deepEqual([...plan.byRoom], [['Bedroom 1', ['photo-4']]])
  assert.deepEqual(plan.duplicateAssets, [duplicate])
})

test('the same URL assigned to multiple rooms is counted once', () => {
  const plan = buildPhotoScanPlan([{ url: ' a ', room: 'Bedroom' }, { url: 'a', room: 'Office' }], ['a'])
  assert.equal(plan.byRoom.size, 1)
  assert.equal(plan.duplicateAssets.length, 1)
})

test('distinct angles and photos whose hash could not be fetched are preserved', () => {
  const assets = [{ url: 'angle-1', room: 'Office' }, { url: 'angle-2', room: 'Office' }, { url: 'unavailable' }]
  const plan = buildPhotoScanPlan(assets, assets.map(asset => asset.url))
  assert.deepEqual([...plan.byRoom], [['Office', ['angle-1', 'angle-2']], ['other', ['unavailable']]])
  assert.deepEqual(plan.duplicateAssets, [])
  assert.equal(assets.length, 3)
})
