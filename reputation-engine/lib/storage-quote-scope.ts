import type { JobFactors, QuoteLeg, QuoteLineItem } from './types'

export type QuoteType = 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'

export function removeStorageQuoteScope(input: {
  factors: JobFactors
  legs: QuoteLeg[]
  lineItems: QuoteLineItem[]
  fallbackQuoteType: Exclude<QuoteType, 'storage'>
}) {
  const nextFactors: JobFactors = {
    ...input.factors,
    temporaryStorageNeeded: false,
    storageDurationKnown: false,
    storageEstimatedMonths: undefined,
    storageMonthlyAllowance: undefined,
    planningScenario: input.factors.planningScenario === 'storage_staged' ? 'standard' : input.factors.planningScenario,
    preferredOperatingPlan: input.factors.preferredOperatingPlan === 'split_day_storage'
      ? undefined
      : input.factors.preferredOperatingPlan,
  }
  const nextLegs = input.legs.filter(leg => leg.type !== 'storage' && leg.type !== 'storage_delivery')
  const nextLineItems = input.lineItems.filter(item => !/\bstorage\b/i.test(item.description || ''))

  return {
    factors: nextFactors,
    legs: nextLegs,
    lineItems: nextLineItems,
    quoteType: input.fallbackQuoteType,
    legsEnabled: nextLegs.length > 0,
  }
}
