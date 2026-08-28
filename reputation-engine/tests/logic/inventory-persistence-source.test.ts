import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.join(process.cwd(), 'app/sales/leads/[id]/page.tsx'), 'utf8')

test('a background lead refresh cannot replace inventory while a richer local snapshot is saving', () => {
  assert.match(source, /inventoryPersistPendingRef = useRef\(false\)/)
  assert.match(source, /preserveInventory: inventoryPersistPendingRef\.current/)
  assert.match(source, /if \(!options\?\.preserveInventory\) setInventory/)
  assert.match(source, /inventoryPersistPendingRef\.current = true/)
  assert.match(source, /inventoryPersistPendingRef\.current = false/)
})
