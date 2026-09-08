import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateAdjustmentAmount } from '../../lib/estimate-adjustment'
import { resolveOntarioPriceOverride } from '../../lib/quote-pricing-safety'

test('calculated shortcut preserves cents and the same price in both tax modes', () => {
  const subtotal = 1234.56
  for (const mode of ['plus_hst', 'hst_included'] as const) {
    const amount = estimateAdjustmentAmount(subtotal, mode, 0)
    assert.equal(resolveOntarioPriceOverride(amount, mode).subtotal, subtotal)
  }
})

test('percentage shortcuts increase the pretax price equally in both tax modes', () => {
  for (const percent of [5, 10, 15]) {
    for (const mode of ['plus_hst', 'hst_included'] as const) {
      const amount = estimateAdjustmentAmount(1000, mode, percent)
      assert.equal(resolveOntarioPriceOverride(amount, mode).subtotal, 1000 * (1 + percent / 100))
    }
  }
})
