import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(path.join(process.cwd(), 'app/components/sales/lead-detail/estimate-draft-modal.tsx'), 'utf8')

test('estimate workspace offers simple and guided views over the same draft', () => {
  assert.match(source, /useState<'simple' \| 'guided'>\('simple'\)/)
  assert.doesNotMatch(source, /sales-estimate-view/)
  assert.match(source, /Both views save the same complete move context/)
  assert.match(source, /estimateView === 'guided' \? <style>/)
})

test('price override requires an explicit tax meaning', () => {
  assert.match(source, /useState<OntarioPriceOverrideMode \| null>\(null\)/)
  assert.match(source, /Price \+ HST/)
  assert.match(source, /HST included \/ all-in/)
  assert.match(source, /resolveOntarioPriceOverride\(Number\(overrideInput/)
  assert.match(source, /There is no assumed default/)
})

test('simple view previews an unresolved estimate as provisional instead of dead-ending the rep', () => {
  assert.match(source, /estimateView === 'simple'[\s\S]*await handleProvisionalSend\(\)/)
  assert.match(source, /Preview provisional estimate/)
  assert.match(source, /<details open=\{estimateView === 'guided' \? true : undefined\}/)
})
