import type { CRMLead, CRMQuote } from './types'

export type JobCostRecord = {
  category: string
  amount_cents: number
}

export type JobOutcomeActuals = {
  actualHours?: number | null
  actualCrew?: number | null
  damageFlag?: boolean
  customerRating?: number | null
  varianceReason?: string | null
}

export type JobBottleneck =
  | 'scope'
  | 'labor'
  | 'truck'
  | 'fuel'
  | 'access'
  | 'customer_delay'
  | 'damage'
  | 'payment'
  | 'missing_actuals'
  | 'on_plan'

export type JobTelemetrySnapshot = {
  revenue: number
  estimatedVolumeCf: number
  estimatedWeightLbs: number
  estimatedHours: number
  actualHours: number | null
  hoursVariance: number | null
  estimatedCrew: number
  actualCrew: number | null
  estimatedCost: number
  actualCost: number
  costVariance: number
  estimatedGrossProfit: number
  actualGrossProfit: number
  estimatedMarginPct: number
  actualMarginPct: number
  primaryBottleneck: JobBottleneck
  varianceReasons: string[]
  actualsComplete: boolean
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0
}

function costTotal(costs: JobCostRecord[], categories?: string[]) {
  return money(costs
    .filter(cost => !categories || categories.includes(cost.category))
    .reduce((sum, cost) => sum + Number(cost.amount_cents || 0) / 100, 0))
}

export function deriveJobTelemetry(input: {
  lead: CRMLead
  quote?: CRMQuote | null
  costs?: JobCostRecord[]
  actuals?: JobOutcomeActuals
  cashPending?: number
}): JobTelemetrySnapshot {
  const { lead, quote } = input
  const costs = input.costs || []
  const actualHours = Number(input.actuals?.actualHours ?? lead.moveExecutionLog?.actualHours ?? 0) || null
  const estimatedHours = Number(quote?.estimatedHours ?? lead.moveExecutionLog?.predictedHours ?? 0)
  const actualCrew = Number(input.actuals?.actualCrew ?? 0) || null
  const estimatedCrew = Number(quote?.crewSize || 0)
  const revenue = money(Number(quote?.subtotal || 0))
  const internal = (quote as (CRMQuote & { pricingBreakdown?: { internalCostEstimate?: { totalCost?: number; laborCost?: number; truckOpsCost?: number } } }) | null | undefined)?.pricingBreakdown?.internalCostEstimate
  const fallbackLaborBudget = Number(quote?.crewSize || 0) * Number(quote?.estimatedHours || 0) * 20
  const fallbackRouteBudget = Number(quote?.longDistanceTruckCost || 0) + Number(quote?.longDistanceGasCost || 0) + Number(quote?.longDistanceInsuranceCost || 0) + Number(quote?.longDistanceMiscCost || 0)
  const estimatedCost = money(Number(internal?.totalCost || (fallbackLaborBudget + fallbackRouteBudget)))
  const actualCost = costTotal(costs)
  const estimatedGrossProfit = money(revenue - estimatedCost)
  const actualGrossProfit = money(revenue - actualCost)
  const hoursVariance = actualHours !== null && estimatedHours > 0 ? money(actualHours - estimatedHours) : null
  const costVariance = money(actualCost - estimatedCost)
  const inventory = (lead.inventory || []).filter(item => item.included !== false)
  const estimatedVolumeCf = money(inventory.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0))
  const estimatedWeightLbs = money(inventory.reduce((sum, item) => sum + Number(item.weightLbs || 0) * Math.max(1, Number(item.qty || 1)), 0))
  const issues = lead.moveExecutionLog?.issues || []
  const reasons: string[] = []
  let primaryBottleneck: JobBottleneck = 'on_plan'

  const hasIssue = (category: string) => issues.some(issue => issue.category === category)
  const actualLabor = costTotal(costs, ['labor'])
  const actualTruck = costTotal(costs, ['truck', 'equipment'])
  const actualFuel = costTotal(costs, ['fuel', 'tolls'])
  const laborBudget = Number(internal?.laborCost || 0)
  const truckBudget = Number(internal?.truckOpsCost || 0)

  if (input.actuals?.damageFlag || hasIssue('damage') || costTotal(costs, ['claims']) > 0) {
    primaryBottleneck = 'damage'
    reasons.push('Damage or claim activity affected the job.')
  } else if (hasIssue('inventory')) {
    primaryBottleneck = 'scope'
    reasons.push('Actual inventory differed from the sold scope.')
  } else if (hasIssue('access')) {
    primaryBottleneck = 'access'
    reasons.push('Access conditions affected execution.')
  } else if (hasIssue('customer_delay')) {
    primaryBottleneck = 'customer_delay'
    reasons.push('Customer readiness or timing delayed the crew.')
  } else if (actualTruck > Math.max(100, truckBudget * 1.15)) {
    primaryBottleneck = 'truck'
    reasons.push('Truck or equipment cost exceeded its operating budget.')
  } else if (actualFuel > 0 && actualFuel > Math.max(75, truckBudget * 0.45)) {
    primaryBottleneck = 'fuel'
    reasons.push('Fuel and toll cost were materially high for the plan.')
  } else if ((hoursVariance !== null && hoursVariance > 0.5) || actualLabor > Math.max(100, laborBudget * 1.15)) {
    primaryBottleneck = 'labor'
    reasons.push('Labor hours or labor cost exceeded the estimate.')
  } else if (Number(input.cashPending || 0) > 0) {
    primaryBottleneck = 'payment'
    reasons.push('Customer revenue remains uncollected.')
  } else if (actualHours === null || costs.length === 0) {
    primaryBottleneck = 'missing_actuals'
    reasons.push('Actual hours or job costs are not fully logged.')
  }

  const writtenReason = input.actuals?.varianceReason || lead.moveExecutionLog?.varianceReason
  if (writtenReason && !reasons.includes(writtenReason)) reasons.push(writtenReason)
  if (costVariance > 0) reasons.push(`Actual cost is $${costVariance.toFixed(2)} over the estimate.`)
  if (hoursVariance !== null && hoursVariance > 0) reasons.push(`Execution ran ${hoursVariance} hour${hoursVariance === 1 ? '' : 's'} over plan.`)

  return {
    revenue,
    estimatedVolumeCf,
    estimatedWeightLbs,
    estimatedHours,
    actualHours,
    hoursVariance,
    estimatedCrew,
    actualCrew,
    estimatedCost,
    actualCost,
    costVariance,
    estimatedGrossProfit,
    actualGrossProfit,
    estimatedMarginPct: percentage(estimatedGrossProfit, revenue),
    actualMarginPct: percentage(actualGrossProfit, revenue),
    primaryBottleneck,
    varianceReasons: reasons,
    actualsComplete: actualHours !== null && costs.length > 0,
  }
}
