import type { JobFactors, PricingBreakdown, QuoteLineItem } from './types'

export const MAJOR_MOVE_THRESHOLD = 3000
export const TARGET_CONTRIBUTION_MARGIN = 0.38
export const MINIMUM_CONTRIBUTION_MARGIN = 0.30

export interface ContributionCostLine { key: string; label: string; amount: number }
export interface ContributionReserveLine extends ContributionCostLine { rate: number }
export interface ContributionPricingPlan {
  isMajorMove: boolean
  fixedFulfillmentCost: number
  variableCostRate: number
  costs: ContributionCostLine[]
  reserves: ContributionReserveLine[]
  executionContingencyTotal: number
  recommendedPrice: number
  minimumAuthorizedPrice: number
  currentPrice: number
  expectedContribution: number
  contributionMarginPct: number
}

const money = (value: number) => Math.round(Math.max(0, value || 0) * 100) / 100
const roundQuote = (value: number) => Math.ceil(Math.max(0, value) / 50) * 50

export function buildContributionPricingPlan(input: {
  currentPrice: number
  pricing?: PricingBreakdown | null
  lineItems?: QuoteLineItem[]
  factors?: JobFactors
  binding?: boolean
}): ContributionPricingPlan {
  const currentPrice = money(input.currentPrice)
  const internal = input.pricing?.internalCostEstimate
  const factors = input.factors || {}
  const lines = input.lineItems || []
  const hasStorage = factors.temporaryStorageNeeded || lines.some(item => /storage/i.test(item.description))
  const junkRevenue = lines.filter(item => /junk|disposal/i.test(item.description)).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const suppliedKitCount = lines.some(item => /40 .*box/i.test(item.description)) ? 40 : lines.some(item => /20 .*box/i.test(item.description)) ? 20 : 0
  const costs: ContributionCostLine[] = [
    { key: 'fulfillment_labor', label: 'Crew / subcontractor fulfillment', amount: money(internal?.laborCost || 0) },
    { key: 'truck_operations', label: 'Truck, fuel and mileage', amount: money(internal?.truckOpsCost || 0) },
    { key: 'packing_materials', label: 'Packing materials', amount: money(internal?.suppliesCost || 0) },
    { key: 'box_kit', label: 'Saturn Star box kit', amount: money(suppliedKitCount * 1.5) },
    { key: 'box_delivery', label: 'Box-kit delivery allowance', amount: suppliedKitCount ? 65 : 0 },
    { key: 'storage', label: 'Storage fulfillment allowance', amount: hasStorage ? money((factors.storageMonthlyAllowance || 150) * Math.max(1, factors.storageEstimatedMonths || 1)) : 0 },
    { key: 'junk', label: 'Junk labour and disposal allowance', amount: junkRevenue ? money(Math.max(100, junkRevenue * 0.45)) : 0 },
    { key: 'commercial', label: 'Commercial direct fulfillment', amount: money(internal?.commercialDirectCost || 0) },
    { key: 'crew_incentives', label: 'Crew quality / review incentive', amount: currentPrice >= MAJOR_MOVE_THRESHOLD ? 100 : 0 },
    { key: 'contingency', label: 'Execution contingency', amount: money(((internal?.laborCost || 0) + (internal?.truckOpsCost || 0)) * 0.08) },
  ].filter(item => item.amount > 0)
  const fixedFulfillmentCost = money(costs.reduce((sum, item) => sum + item.amount, 0))
  // These scale with the final selling price and therefore belong in the reverse-price denominator.
  const variableCostRate = 0.05 + 0.03 + 0.04 + 0.02 + 0.03 // commission, cards, acquisition, claims, coordination
  const recommendedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - TARGET_CONTRIBUTION_MARGIN))
  const minimumAuthorizedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - MINIMUM_CONTRIBUTION_MARGIN))
  const reserveDefinitions = [
    { key: 'sales_commission', label: 'Sales commission', rate: 0.05 },
    { key: 'card_processing', label: 'Card processing', rate: 0.03 },
    { key: 'acquisition', label: 'Acquisition allocation', rate: 0.04 },
    { key: 'claims', label: 'Claims reserve', rate: 0.02 },
    { key: 'coordination', label: 'Move coordination', rate: 0.03 },
  ]
  const reserves = reserveDefinitions.map(reserve => ({ ...reserve, amount: money(recommendedPrice * reserve.rate) }))
  const executionContingencyTotal = money(
    (costs.find(cost => cost.key === 'contingency')?.amount || 0) + reserves.reduce((sum, reserve) => sum + reserve.amount, 0)
  )
  const variableCosts = currentPrice * variableCostRate
  const expectedContribution = money(currentPrice - fixedFulfillmentCost - variableCosts)
  const isMajorMove = Boolean(input.binding || currentPrice >= MAJOR_MOVE_THRESHOLD || recommendedPrice >= MAJOR_MOVE_THRESHOLD)
  return {
    isMajorMove, fixedFulfillmentCost, variableCostRate, costs, reserves, executionContingencyTotal,
    recommendedPrice, minimumAuthorizedPrice, currentPrice,
    expectedContribution,
    contributionMarginPct: currentPrice ? Math.round(expectedContribution / currentPrice * 1000) / 10 : 0,
  }
}
