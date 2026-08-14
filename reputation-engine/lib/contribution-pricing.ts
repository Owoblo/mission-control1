import type { InventoryItem, JobFactors, PricingBreakdown, QuoteLineItem } from './types'

export const MAJOR_MOVE_THRESHOLD = 3000
export const TARGET_CONTRIBUTION_MARGIN = 0.38
export const MINIMUM_CONTRIBUTION_MARGIN = 0.30

export type ContributionCostClass = 'core_move' | 'evidence_required' | 'customer_selected' | 'live_job'
export interface ContributionCostLine {
  key: string
  label: string
  amount: number
  classification: ContributionCostClass
  sellingAllocation?: number
}
export interface ContributionReserveLine extends ContributionCostLine { rate: number }
export interface ContributionPricingGap { key: string; label: string; reason: string }
export interface ContributionPricingPlan {
  isMajorMove: boolean
  fixedFulfillmentCost: number
  variableCostRate: number
  costs: ContributionCostLine[]
  pricingGaps: ContributionPricingGap[]
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

export function buildProtectionRecommendation(input: {
  currentPrice: number
  pricing?: PricingBreakdown | null
  factors?: JobFactors
  inventory?: InventoryItem[]
}) {
  const inventory = (input.inventory || []).filter(item => item.included !== false)
  const inventoryText = inventory.map(item => `${item.name || item.item || ''} ${item.notes || ''}`).join(' ').toLowerCase()
  const tvCount = inventory
    .filter(item => /\b(tv|television|flat.?screen)\b/i.test(`${item.name || item.item || ''}`) && !/box|stand|unit|cabinet/i.test(`${item.name || item.item || ''}`))
    .reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
  const reasons: string[] = []
  let price = 99
  if (input.currentPrice >= 6000) { price += 50; reasons.push('high-value move') }
  else if (input.currentPrice >= 3000) { price += 25; reasons.push('major move') }
  if (input.pricing?.routeCategory === 'long-distance') { price += 50; reasons.push('long-distance handling') }
  if (Number(input.pricing?.totalCubicFeet || 0) >= 1200) { price += 25; reasons.push('large inventory') }
  if (tvCount >= 2) { price += 25; reasons.push(`${tvCount} televisions`) }
  if (/\b(piano|safe|pool table|hot tub|jacuzzi)\b/i.test(inventoryText)) { price += 50; reasons.push('specialty inventory') }
  if (input.factors?.temporaryStorageNeeded) { price += 25; reasons.push('multiple handling stages') }
  return { price: Math.min(299, Math.ceil(price / 25) * 25), reasons }
}

export function buildContributionPricingPlan(input: {
  currentPrice: number
  pricing?: PricingBreakdown | null
  lineItems?: QuoteLineItem[]
  factors?: JobFactors
  binding?: boolean
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  moveDate?: string
  inventory?: InventoryItem[]
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
  const tvInventory = (input.inventory || []).filter(item => {
    const label = `${item.name || item.item || ''}`.toLowerCase()
    return item.included !== false && /\b(tv|television|flat.?screen)\b/i.test(label) && !/box|stand|unit|cabinet/.test(label)
  })
  const tvBoxPlan = tvInventory.map(item => {
    const label = `${item.name || item.item || ''} ${item.size || ''} ${item.notes || ''}`
    const sizes = Array.from(label.matchAll(/(\d{2,3})\s*(?:inch|in\b|")?/gi)).map(match => Number(match[1]))
    const inches = sizes.length ? Math.max(...sizes) : 55
    const tier = inches <= 40 ? { label: 'Medium', cost: 21 } : inches <= 70 ? { label: 'Large', cost: 29 } : { label: 'XL', cost: 38 }
    return { ...tier, qty: Math.max(1, Number(item.qty || 1)) }
  })
  const protectedTvCount = tvBoxLines.length > 0 ? 0 : tvBoxPlan.reduce((sum, item) => sum + item.qty, 0) || Number(tvProtectionLine?.details?.match(/^(\d+)/)?.[1] || 0)
  const inferredTvBoxCost = tvBoxPlan.length > 0
    ? tvBoxPlan.reduce((sum, item) => sum + item.cost * item.qty, 0)
    : protectedTvCount * 29
  const manualTvBoxCost = tvBoxLines.reduce((sum, item) => sum + (Number(item.amount || 0) > 0 ? Number(item.amount) / 1.1 : 29), 0)
  const tvBoxCost = money(tvBoxLines.length > 0 ? manualTvBoxCost : inferredTvBoxCost)
  const tvBoxesByTier = tvBoxPlan.reduce<Record<string, number>>((summary, item) => {
    summary[item.label] = (summary[item.label] || 0) + item.qty
    return summary
  }, {})
  const tvBoxBasis = tvBoxPlan.length > 0
    ? Object.entries(tvBoxesByTier).map(([tier, qty]) => `${qty}× ${tier}`).join(' · ')
    : `${protectedTvCount} size pending`
  const packingIncluded = lines.some(item => /professional packing service/i.test(item.description))
  const packingDay = input.pricing?.intelligenceFlags?.packingDayEstimate
  const packingManHours = packingIncluded && packingDay ? money(packingDay.crewSize * packingDay.hours) : 0
  const packingLaborCost = money(packingManHours * 25)
  const unpackingIncluded = lines.some(item => /professional unpacking service/i.test(item.description))
  const unpackingManHours = unpackingIncluded ? money(Math.max(20, suppliedKitCount) * 0.125) : 0
  const unpackingLaborCost = money(unpackingManHours * 25)
  const mountedTvLine = lines.find(item => /wall-mounted tv dismount/i.test(item.description))
  const mountedTvCount = Number(mountedTvLine?.details?.match(/^(\d+)/)?.[1] || 0)
  const hotelNights = isLongDistance && Number(input.pricing?.totalHours || 0) > 12
    ? Math.max(1, Math.ceil(Number(input.pricing?.totalHours || 0) / 10) - 1) : 0
  const hotelRooms = Math.max(1, Math.ceil(Number(input.pricing?.crewSize || 2) / 2))
  const hotelCost = hotelNights * hotelRooms * 180
  const crewMealsCost = isLongDistance ? Math.max(2, Number(input.pricing?.crewSize || 2)) * (hotelNights + 1) * 25 : 0
  const specialtyInventory = (input.inventory || []).filter(item => {
    const label = `${item.name || item.item || ''} ${item.notes || ''}`
    return item.included !== false && /\b(piano|safe|pool table|billiard table|hot tub|jacuzzi)\b/i.test(label)
  })
  const specialtyLines = lines.filter(item => /\b(piano|safe|pool table|billiard table|hot tub|jacuzzi|specialty handling)\b/i.test(item.description))
  const specialtyRevenue = specialtyLines.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const specialtyCost = money(specialtyRevenue / 1.2)
  const specialtyPricedText = specialtyLines.map(item => item.description).join(' ').toLowerCase()
  const pricingGaps = specialtyInventory
    .filter(item => !specialtyPricedText.includes(`${item.name || item.item || ''}`.toLowerCase()) && specialtyLines.length === 0)
    .map((item, index) => ({
      key: `specialty-${item.id || index}`,
      label: item.name || item.item || 'Specialty item',
      reason: 'Detected from inventory; confirm access/equipment and add a specialty fulfillment price before sending.',
    }))
  const liveExecutionBase = money((internal?.laborCost || 0) + (internal?.truckOpsCost || 0) + (internal?.suppliesCost || 0) + hotelCost + crewMealsCost)
  const nonBoxPackingMaterialsCost = money(Math.max(0, Number(internal?.suppliesCost || 0) - suppliedKitCount * 1.5))
  const costs = ([
    { key: 'fulfillment_labor', label: 'Crew / subcontractor fulfillment', amount: money(internal?.laborCost || 0), classification: 'core_move' },
    { key: 'truck_operations', label: 'Truck, fuel and mileage', amount: money(internal?.truckOpsCost || 0), classification: 'core_move' },
    { key: 'packing_materials', label: 'Tape, wrap and packing materials', amount: nonBoxPackingMaterialsCost, classification: 'core_move' },
    { key: 'box_kit', label: `Moving boxes (${suppliedKitCount} supplied)`, amount: money(suppliedKitCount * 1.5), classification: 'core_move' },
    { key: 'box_delivery', label: 'Box delivery labour, vehicle & re-delivery allowance', amount: suppliedKitCount ? (isLongDistance ? 85 : 65) : 0, classification: 'core_move' },
    { key: 'tv_boxes', label: `TV protection boxes (${tvBoxBasis})`, amount: tvBoxCost, classification: 'evidence_required', sellingAllocation: money(tvBoxLines.reduce((sum, item) => sum + Number(item.amount || 0), 0)) },
    { key: 'packing_labor', label: `Professional packing fulfillment (${packingManHours} labour-hours)`, amount: packingLaborCost, classification: 'customer_selected', sellingAllocation: money(lines.filter(item => /professional packing service/i.test(item.description)).reduce((sum, item) => sum + Number(item.amount || 0), 0)) },
    { key: 'unpacking_labor', label: `Professional unpacking fulfillment (~${unpackingManHours} labour-hours)`, amount: unpackingLaborCost, classification: 'customer_selected', sellingAllocation: money(lines.filter(item => /professional unpacking service/i.test(item.description)).reduce((sum, item) => sum + Number(item.amount || 0), 0)) },
    { key: 'tv_mounting', label: 'TV dismount/remount labour & hardware allowance', amount: money(mountedTvCount * 70), classification: 'evidence_required', sellingAllocation: money(Number(mountedTvLine?.amount || 0)) },
    { key: 'specialty', label: 'Specialty subcontractor / equipment allowance', amount: specialtyCost, classification: 'evidence_required', sellingAllocation: money(specialtyRevenue) },
    { key: 'furniture_protection', label: 'Furniture wrap, padding and floor protection', amount: quoteType === 'labor_only' || quoteType === 'packing_only' ? 0 : money(Math.max(1, Number(input.pricing?.truckCount || 1)) * 35), classification: 'core_move' },
    { key: 'storage', label: 'Storage fulfillment allowance', amount: hasStorage ? money((factors.storageMonthlyAllowance || 150) * Math.max(1, factors.storageEstimatedMonths || 1)) : 0, classification: 'customer_selected', sellingAllocation: money(lines.filter(item => /storage/i.test(item.description)).reduce((sum, item) => sum + Number(item.amount || 0), 0)) },
    { key: 'junk', label: 'Junk labour and disposal allowance', amount: hasJunk ? money(Math.max(100, junkRevenue * 0.45)) : 0, classification: 'customer_selected', sellingAllocation: money(junkRevenue) },
    { key: 'commercial', label: 'Commercial direct fulfillment', amount: money(internal?.commercialDirectCost || 0), classification: 'core_move' },
    { key: 'crew_meals', label: 'Long-distance crew meals', amount: money(crewMealsCost), classification: 'evidence_required' },
    { key: 'lodging', label: `Long-distance lodging (${hotelRooms} room${hotelRooms === 1 ? '' : 's'} × ${hotelNights} night${hotelNights === 1 ? '' : 's'})`, amount: money(hotelCost), classification: 'evidence_required' },
    { key: 'contingency', label: 'Operational contingency', amount: money(liveExecutionBase * operationalContingencyRate), classification: 'live_job' },
  ] satisfies ContributionCostLine[]).filter(item => item.amount > 0)
  const fixedFulfillmentCost = money(costs.reduce((sum, item) => sum + item.amount, 0))
  // Marketing, commission, claims and coordination are already absorbed by the
  // company's margin target. Only the actual payment rail scales per live job.
  const variableCostRate = 0.03
  const recommendedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - TARGET_CONTRIBUTION_MARGIN))
  const minimumAuthorizedPrice = roundQuote(fixedFulfillmentCost / (1 - variableCostRate - MINIMUM_CONTRIBUTION_MARGIN))
  const reserveDefinitions = [{ key: 'card_processing', label: 'Card processing', rate: 0.03, classification: 'live_job' as const }]
  const reserves = reserveDefinitions.map(reserve => ({ ...reserve, amount: money(recommendedPrice * reserve.rate) }))
  const executionContingencyTotal = money(
    (costs.find(cost => cost.key === 'contingency')?.amount || 0) + reserves.reduce((sum, reserve) => sum + reserve.amount, 0)
  )
  const variableCosts = currentPrice * variableCostRate
  const expectedContribution = money(currentPrice - fixedFulfillmentCost - variableCosts)
  const isMajorMove = Boolean(input.binding || currentPrice >= MAJOR_MOVE_THRESHOLD || recommendedPrice >= MAJOR_MOVE_THRESHOLD)
  return {
    isMajorMove, fixedFulfillmentCost, variableCostRate, costs, pricingGaps, reserves, operationalContingencyRate, executionContingencyTotal,
    recommendedPrice, minimumAuthorizedPrice, currentPrice,
    expectedContribution,
    contributionMarginPct: currentPrice ? Math.round(expectedContribution / currentPrice * 1000) / 10 : 0,
  }
}
