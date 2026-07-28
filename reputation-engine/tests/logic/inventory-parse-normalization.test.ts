import assert from 'node:assert/strict'
import test from 'node:test'
import { expandCompoundInventoryPhrases } from '../../lib/inventory-parse-normalization'

test('a television and stand are separate inventory objects', () => {
  assert.deepEqual(
    expandCompoundInventoryPhrases([
      { name: '56 Inch Plasma Television + Stand', qty: 1, room: 'Living Room' },
    ]),
    [
      { name: '56" TV', qty: 1, room: 'Living Room' },
      { name: 'TV Stand', qty: 1, room: 'Living Room' },
    ]
  )
})

test('ordinary single items remain unchanged', () => {
  const input = [{ name: 'Coffee Table', qty: 1, room: 'Living Room' }]
  assert.deepEqual(expandCompoundInventoryPhrases(input), input)
})
