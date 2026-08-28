import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const estimateWorkspace = fs.readFileSync(
  path.join(process.cwd(), 'app/components/sales/lead-detail/estimate-draft-modal.tsx'),
  'utf8',
)
const leadWorkspace = fs.readFileSync(
  path.join(process.cwd(), 'app/sales/leads/[id]/page.tsx'),
  'utf8',
)

test('manual override requires an explicit plus-HST or all-in meaning', () => {
  assert.match(estimateWorkspace, /Price \+ HST/)
  assert.match(estimateWorkspace, /HST included \/ all-in/)
  assert.match(estimateWorkspace, /resolveOntarioPriceOverride\(Number\(overrideInput/)
  assert.doesNotMatch(estimateWorkspace, /Enter the .*pre-tax base price/)
})

test('saved override total uses the canonical total including HST', () => {
  assert.match(leadWorkspace, /overrideLineItem \? totals\.total : undefined/)
})

test('an explicit agreed-rate revision updates a viewed quote instead of silently restoring the old price', () => {
  assert.match(leadWorkspace, /hasExplicitPriceRevision/)
  assert.match(leadWorkspace, /quoteIsLockedForPricing && !hasExplicitPriceRevision/)
  assert.match(leadWorkspace, /pricingRevisionReason: proposedOverrideLineItem\?\.details/)
})
