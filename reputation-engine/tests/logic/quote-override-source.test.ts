import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { resolveQuoteDraftPricing } from '../../lib/quote-draft-pricing'
import type { CRMQuote } from '../../lib/types'

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
  const quote = { status: 'draft', lineItems: [], total: 0 } as unknown as CRMQuote
  const result = resolveQuoteDraftPricing(quote, [{ description: 'Moving Services — Agreed Rate', amount: 1400 }], 0, 0.3, false)
  assert.equal(result.priceOverrideTotal, 1582)
})

test('an explicit agreed-rate revision updates a viewed quote instead of silently restoring the old price', () => {
  const quote = { status: 'viewed', lineItems: [{ description: 'Moving Services', amount: 1000 }], total: 1130 } as CRMQuote
  const result = resolveQuoteDraftPricing(quote, [{ description: 'Moving Services — Agreed Rate', amount: 1400 }], 0, 0.3, true)
  assert.equal(result.hasExplicitPriceRevision, true)
  assert.equal(result.preserveCustomerFacingPricing, false)
  assert.equal(result.totals.total, 1582)
  assert.match(leadWorkspace, /pricingRevisionReason: proposedOverrideLineItem\?\.details/)
})
