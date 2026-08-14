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
  operationalContingencyRate: number
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
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  moveDate?: string
}): ContributionPricingPlan {
  const currentPrice = money(input.currentPrice)
  const internal = input.pricing?.internalCostEstimate
  const factors = input.factors || {}
  const lines = input.lineItems || []
  const hasStorage = factors.temporaryStorageNeeded || lines.some(item => /storage/i.test(item.description))
  const hasJunk = lines.some(item => /junk|disposal/i.test(item.description))
  const junkRevenue = lines.filter(item => /junk|disposal/i.test(item.description)).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const asNeededBoxLine = lines.find(item => /as many as needed/i.test(item.description))
  const plannedBoxAllowance = Number(asNeededBoxLine?.details?.match(/(?:allowance|planned)[^0-9]*(\d+)/i)?.[1] || 0)
  const suppliedKitCount = asNeededBoxLine
    ? Math.max(20, plannedBoxAllowance, Number(factors.estimatedBoxes || 0))
    : lines.some(item => /unlimited .*box/i.test(item.description))
    ? Math.max(40, Number(factors.estimatedBoxes || 0))
    : lines.some(item => /40 .*box/i.test(item.description))
      ? 40
      : lines.some(item => /20 .*box/i.test(item.description)) ? 20 : 0
  const routeCategory = internal && input.pricing?.routeCategory
  const quoteType = input.quoteType || (routeCategory === 'long-distance' ? 'long_distance' : 'standard')
  const daysUntilMove = input.moveDate
    ? Math.ceil((new Date(`${input.moveDate}T12:00:00`).getTime() - Date.now()) / 86_400_000)
    : null
  const isLongDistance = quoteType === 'long_distance' || routeCategory === 'long-distance'
  const longMove = Number(input.pricing?.totalHours || 0) >= 10
  const multiTruck = Number(input.pricing?.truckCount || 1) >= 2
  const complexScope = Boolean(factors.temporaryStorageNeeded || factors.planningScenario === 'multi_stop' || factors.planningScenario === 'storage_staged')
  const baseContingencyRate = quoteType === 'labor_only' ? 0.04
    : quoteType === 'packing_only' ? 0.06
      : quoteType === 'storage' ? 0.08
        : isLongDistance ? 0.08 : 0.05
  const operationalContingencyRate = Math.min(0.12,
    baseContingencyRate + (multiTruck ? 0.01 : 0) + (longMove ? 0.01 : 0) + (complexScope ? 0.01 : 0) + (daysUntilMove !== null && daysUntilMove <= 7 ? 0.01 : 0)
  )
  const tvBoxLines = lines.filter(item => /tv box/i.test(item.description))
  const tvProtectionLine = lines.find(item => /^tv protection$/i.test(item.description))
  const protectedTvCount = tvBoxLines.length > 0 ? 0 : Number(tvProtectionLine?.details?.match(/^(\d+)/)?.[1] || 0)
  const tvBoxCost = money(tvBoxLines.reduce((sum, item) => sum + (Number(item.amount || 0) > 0 ? Number(item.amount) / 1.1 : 40), 0) + protectedTvCount * 40)
  const packingIncluded = lines.some(item => /professional packing & unpacking/i.test(item.description))
  const packingAndUnpackingLabor = packingIncluded ? money(Math.max(20, suppliedKitCount) * 9.375) : 0
  const mountedTvLine = lines.find(item => /wall-mounted tv dismount/i.test(item.description))
  const mountedTvCount = Number(mountedTvLine?.details?.match(/^(\d+)/)?.[1] || 0)
  const hotelNights = isLongDistance && Number(input.pricing?.totalHours || 0) > 12
    ? Math.max(1, Math.ceil(Number(input.pricing?.totalHours || 0) / 10) - 1) : 0
  const hotelRooms = Math.max(1, Math.ceil(Number(input.pricing?.crewSize || 2) / 2))
  const hotelCost = hotelNights * hotelRooms * 180
  const crewMealsCost = isLongDistance ? Math.max(2, Number(input.pricing?.crewSize || 2)) * (hotelNights + 1) * 25 : 0
  const liveExecutionBase = money((internal?.laborCost || 0) + (internal?.truckOpsCost || 0) + (internal?.suppliesCost || 0) + hotelCost + crewMealsCost)
  const nonBoxPackingMaterialsCost = money(Math.max(0, Number(internal?.suppliesCost || 0) - suppliedKitCount * 1.5))
  const costs: ContributionCostLine[] = [
    { key: 'fulfillment_labor', label: 'Crew / subcontractor fulfillment', amount: money(internal?.laborCost || 0) },
    { key: 'truck_operations', label: 'Truck, fuel and mileage', amount: money(internal?.truckOpsCost || 0) },
    { key: 'packing_materials', label: 'Tape, wrap and packing materials', amount: nonBoxPackingMaterialsCost },
    { key: 'box_kit', label: `Moving boxes (${suppliedKitCount} supplied)`, amount: money(suppliedKitCount * 1.5) },
    { key: 'box_delivery', label: 'Box delivery labour, vehicle & re-delivery allowance', amount: suppliedKitCount ? (isLongDistance ? 85 : 65) : 0 },
    { key: 'tv_boxes', label: 'TV protection boxes', amount: tvBoxCost },
    { key: 'packing_labor', label: 'Packing & unpacking labour allowance', amount: packingAndUnpackingLabor },
    { key: 'tv_mounting', label: 'TV dismount/remount labour & hardware allowance', amount: money(mountedTvCount * 70) },
    { key: 'furniture_protection', label: 'Furniture wrap, padding and floor protection', amount: quoteType === 'labor_only' || quoteType === 'packing_only' ? 0 : money(Math.max(1, Number(input.pricing?.truckCount || 1)) * 35) },
    { key: 'storage', label: 'Storage fulfillment allowance', amount: hasStorage ? money((factors.storageMonthlyAllowance || 150) * Math.max(1, factors.storageEstimatedMonths || 1)) : 0 },
    { key: 'junk', label: 'Junk labour and disposal allowance', amount: hasJunk ? money(Math.max(100, junkRevenue * 0.45)) : 0 },
    { key: 'commercial', label: 'Commercial direct fulfillment', amount: money(internal?.commercialDirectCost || 0) },
    { key: 'crew_meals', label: 'Long-distance crew meals', amount: money(crewMealsCost) },
    { key: 'lodging', label: `Long-distance lodging (${hotelRooms} room${hotelRooms === 1 ? '' : 's'} × ${hotelNights} night${hotelNights === 1 ? '' : 's'})`, amount: money(hotelCost) },
    { key: 'contingency', label: 'Operational contingency', amount: money(liveExecutionBase * operationalContingencyRate) },
  ].filter(item => item.amount > 0)
  const fixedFulfillmentCost = money(costs.reduce((sum, item) => sum + item.amount, 0))
  // Marketing, commission, claims and coordination are already absorbed by the
  // company's margin target. Only the actual payment rail scales per live job.
  const variableCostRate = 0.03
  const recommendedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - TARGET_CONTRIBUTION_MARGIN))
  const minimumAuthorizedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - MINIMUM_CONTRIBUTION_MARGIN))
  const reserveDefinitions = [{ key: 'card_processing', label: 'Card processing', rate: 0.03 }]
  const reserves = reserveDefinitions.map(reserve => ({ ...reserve, amount: money(recommendedPrice * reserve.rate) }))
  const executionContingencyTotal = money(
    (costs.find(cost => cost.key === 'contingency')?.amount || 0) + reserves.reduce((sum, reserve) => sum + reserve.amount, 0)
  )
  const variableCosts = currentPrice * variableCostRate
  const expectedContribution = money(currentPrice - fixedFulfillmentCost - variableCosts)
  const isMajorMove = Boolean(input.binding || currentPrice >= MAJOR_MOVE_THRESHOLD || recommendedPrice >= MAJOR_MOVE_THRESHOLD)
  return {
    isMajorMove, fixedFulfillmentCost, variableCostRate, costs, reserves, operationalContingencyRate, executionContingencyTotal,
    recommendedPrice, minimumAuthorizedPrice, currentPrice,
    expectedContribution,
    contributionMarginPct: currentPrice ? Math.round(expectedContribution / currentPrice * 1000) / 10 : 0,
  }
}
