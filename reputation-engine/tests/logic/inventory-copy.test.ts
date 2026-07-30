import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInventorySnapshotCopyText } from '../../lib/inventory-copy'

test('copied inventory is a clean customer-safe scope with consolidated handling', () => {
  const copy = buildInventorySnapshotCopyText([
    { room: 'Living Room', name: 'End Table', qty: 2, cubicFeet: 3, notes: 'Dimensions matched from Saturn Star inventory presets; confirm size if atypical.' },
    { room: 'Living Room', name: 'Lazy Boy Recliner Couch', qty: 1, cubicFeet: 30, notes: 'Automatically parsed from customer SMS; rep review required.' },
    { room: 'Basement', name: 'Pinball Machine', qty: 2, cubicFeet: 25, notes: 'Very heavy — dolly required. which I might move myself' },
    { room: 'Packing scope', name: 'Recliner Chair', qty: 1, cubicFeet: 30, size: 'Lay flat for transport', notes: 'Captured from customer SMS; dimensions still need enrichment.' },
  ])

  assert.match(copy, /## Living Room/)
  assert.match(copy, /\* 2 End Tables/)
  assert.match(copy, /\* 1 La-Z-Boy Reclining Sofa/)
  assert.match(copy, /## Additional Item/)
  assert.match(copy, /\*Customer may move these separately\.\*/)
  assert.match(copy, /## Estimated Total[\s\S]*\*\*6 items · 116 cu\. ft\.\*\*/)
  assert.match(copy, /### Special Handling/)
  assert.doesNotMatch(copy, /Automatically parsed|Saturn Star inventory presets|rep review required|dimensions still need enrichment/i)
})
