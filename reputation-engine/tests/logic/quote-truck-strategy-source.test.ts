import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(process.cwd())

test('truck strategy selection updates the persisted operational override', () => {
  const source = fs.readFileSync(path.join(root, 'app/components/sales/lead-detail/estimate-draft-modal.tsx'), 'utf8')
  assert.match(source, /function selectTruckStrategy\(strategy: TripStrategy\)/)
  assert.match(source, /truckCountOverride,/)
  assert.match(source, /onClick=\{\(\) => selectTruckStrategy\(strategy\)\}/)
  assert.match(source, /onOperationalPlanChange\?\.\(\{/)
})

test('public quote at-a-glance counts physical pieces rather than inventory rows', () => {
  const source = fs.readFileSync(path.join(root, 'app/quote-accept/page.tsx'), 'utf8')
  assert.match(source, /totalInventoryPieces = inventory\.reduce/)
  assert.match(source, /`\$\{totalInventoryPieces\} Pieces`/)
  assert.doesNotMatch(source, /`\$\{inventory\.length\} Items`/)
})
