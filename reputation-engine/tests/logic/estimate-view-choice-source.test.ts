import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.join(process.cwd(), 'app/components/sales/lead-detail/estimate-draft-modal.tsx'), 'utf8')

test('estimate workspace offers simple and guided views over the same draft', () => {
  assert.match(source, /useState<'simple' \| 'guided'>\('simple'\)/)
  assert.match(source, /sales-estimate-view/)
  assert.match(source, /Both views save the same complete move context/)
  assert.match(source, /estimateView === 'guided' \? <style>/)
})

test('price override requires an explicit tax meaning', () => {
  assert.match(source, /Price \+ HST/)
  assert.match(source, /HST included \/ all-in/)
  assert.match(source, /resolveOntarioPriceOverride\(Number\(overrideInput/)
})
