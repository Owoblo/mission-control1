import { resolveOntarioPriceOverride, type OntarioPriceOverrideMode } from './quote-pricing-safety'

/** Return the input amount in the selected tax mode, preserving the calculated price. */
export function estimateAdjustmentAmount(subtotal: number, mode: OntarioPriceOverrideMode, percent: number) {
  const adjustedSubtotal = Math.round(subtotal * (1 + percent / 100) * 100) / 100
  return mode === 'hst_included' ? resolveOntarioPriceOverride(adjustedSubtotal, 'plus_hst').total : adjustedSubtotal
}
