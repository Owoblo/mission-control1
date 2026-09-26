import test from 'node:test'
import assert from 'node:assert/strict'
import { photoSignature, potentiallySamePhoto } from '../../lib/photo-similarity'
test('low-detail and blank images are not flagged as duplicates', () => {
 const flat = photoSignature(new Uint8Array(72).fill(128))
 assert.equal(potentiallySamePhoto(flat, flat), false)
})
test('visually close signatures are review candidates, not automatic merges', () => {
 const a = { hash: 'aaaaaaaaaaaaaaaa', contrast: 20, mean: 100 }
 assert.equal(potentiallySamePhoto(a, { ...a, hash: 'aaaaaaaaaaaaaaab' }), true)
 assert.equal(potentiallySamePhoto(a, { ...a, hash: '5555555555555555' }), false)
 assert.equal(potentiallySamePhoto(a, { ...a, mean: 200 }), false)
})
test('signature rejects unexpected pixel data', () => {
 assert.throws(() => photoSignature(new Uint8Array(71)))
})
